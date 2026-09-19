const fs = require('fs');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');


/* =========================================================
   CONFIG
========================================================= */

const ANALYSIS_WIDTH = 500;

const MIN_PATH_CHARS = 120;
const MAX_CANDIDATES = 150;
const MIN_REGION_PIXELS = 250;

const MIN_COLOR_VARIATION = 3.5;

/*
 * Classification thresholds.
 * Pehle diagnostic run ke liye intentionally moderate.
 */
const STRONG_SCORE = 0.72;
const GOOD_SCORE = 0.58;
const POSSIBLE_SCORE = 0.42;

/*
 * Gradient ki spatial color change meaningful honi chahiye.
 */
const MIN_ENDPOINT_DISTANCE = 8;


/* =========================================================
   SVG HELPERS
========================================================= */

function getPathTags(svg) {
  return svg.match(
    /<path\b[^>]*>/gi
  ) || [];
}


function getPathData(tag) {
  const match = tag.match(
    /\bd\s*=\s*["']([^"']+)["']/i
  );

  return match ? match[1] : '';
}


function getFill(tag) {
  let match = tag.match(
    /\bfill\s*=\s*["']([^"']+)["']/i
  );

  if (match) {
    return match[1].trim();
  }

  match = tag.match(
    /\bstyle\s*=\s*["']([^"']+)["']/i
  );

  if (match) {
    const fillMatch =
      match[1].match(
        /(?:^|;)\s*fill\s*:\s*([^;]+)/i
      );

    if (fillMatch) {
      return fillMatch[1].trim();
    }
  }

  return null;
}


/*
 * Important:
 * Existing path ko white karta hai.
 *
 * fill attribute ke saath style="fill:..." bhi override
 * karna zaroori hai, warna CSS style fill precedence ki
 * wajah se mask incorrect ho sakta hai.
 */
function forceWhiteFill(tag) {
  let result = tag;

  result = result.replace(
    /\bstyle\s*=\s*["']([^"']*)["']/i,
    (full, style) => {
      let clean = style.replace(
        /(?:^|;)\s*fill\s*:\s*[^;]*/gi,
        ''
      );

      clean = clean
        .split(';')
        .map(value => value.trim())
        .filter(Boolean)
        .join(';');

      if (clean) {
        clean += ';';
      }

      clean += 'fill:#ffffff';

      return `style="${clean}"`;
    }
  );

  if (
    /\bfill\s*=\s*["'][^"']*["']/i.test(
      result
    )
  ) {
    result = result.replace(
      /\bfill\s*=\s*["'][^"']*["']/i,
      'fill="#ffffff"'
    );
  } else {
    result = result.replace(
      /\/?>$/,
      ending => {
        if (ending === '/>') {
          return ' fill="#ffffff"/>';
        }

        return ' fill="#ffffff">';
      }
    );
  }

  return result;
}


/* =========================================================
   ISOLATED MASK SVG
========================================================= */

/*
 * Major change from old analyzer:
 *
 * Baaki paths ko black karne ke bajay completely remove
 * karte hain.
 *
 * Isse target path ko later SVG layers black/cover nahi
 * kar sakti.
 *
 * Transparent background + white target = isolated geometry.
 */
function buildIsolatedMaskSvg(
  svg,
  targetIndex
) {
  let index = -1;

  return svg.replace(
    /<path\b[^>]*>/gi,
    tag => {
      index++;

      if (index === targetIndex) {
        return forceWhiteFill(tag);
      }

      return '';
    }
  );
}


/* =========================================================
   RENDER
========================================================= */

function renderSvg(svg) {
  const resvg = new Resvg(
    svg,
    {
      fitTo: {
        mode: 'width',
        value: ANALYSIS_WIDTH
      },

      background:
        'rgba(0,0,0,0)'
    }
  );

  return resvg
    .render()
    .asPng();
}


/* =========================================================
   MATH
========================================================= */

function mean(values) {
  if (!values.length) {
    return 0;
  }

  let total = 0;

  for (const value of values) {
    total += value;
  }

  return total / values.length;
}


function stdDev(values) {
  if (values.length < 2) {
    return 0;
  }

  const average = mean(values);

  let sum = 0;

  for (const value of values) {
    const difference =
      value - average;

    sum +=
      difference * difference;
  }

  return Math.sqrt(
    sum / values.length
  );
}


function colorDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;

  return Math.sqrt(
    dr * dr +
    dg * dg +
    db * db
  );
}


/* =========================================================
   3x3 SOLVER
========================================================= */

function solve3x3(
  matrix,
  values
) {
  const a =
    matrix.map(
      row => row.slice()
    );

  const b =
    values.slice();

  for (
    let column = 0;
    column < 3;
    column++
  ) {
    let pivot = column;

    for (
      let row = column + 1;
      row < 3;
      row++
    ) {
      if (
        Math.abs(a[row][column]) >
        Math.abs(a[pivot][column])
      ) {
        pivot = row;
      }
    }

    if (
      Math.abs(
        a[pivot][column]
      ) < 1e-10
    ) {
      return null;
    }

    [
      a[column],
      a[pivot]
    ] = [
      a[pivot],
      a[column]
    ];

    [
      b[column],
      b[pivot]
    ] = [
      b[pivot],
      b[column]
    ];

    const divisor =
      a[column][column];

    for (
      let c = column;
      c < 3;
      c++
    ) {
      a[column][c] /=
        divisor;
    }

    b[column] /=
      divisor;

    for (
      let row = 0;
      row < 3;
      row++
    ) {
      if (row === column) {
        continue;
      }

      const factor =
        a[row][column];

      for (
        let c = column;
        c < 3;
        c++
      ) {
        a[row][c] -=
          factor *
          a[column][c];
      }

      b[row] -=
        factor *
        b[column];
    }
  }

  return b;
}


/* =========================================================
   CHANNEL PLANE FIT
========================================================= */

/*
 * Channel = A*x + B*y + C
 *
 * Isko independently R/G/B ke liye fit karenge.
 */
function fitChannelPlane(
  points,
  channel
) {
  let xx = 0;
  let xy = 0;
  let yy = 0;

  let sx = 0;
  let sy = 0;

  let xv = 0;
  let yv = 0;
  let sv = 0;

  const count =
    points.length;

  for (const point of points) {
    const value =
      point[channel];

    xx += point.x * point.x;
    xy += point.x * point.y;
    yy += point.y * point.y;

    sx += point.x;
    sy += point.y;

    xv += point.x * value;
    yv += point.y * value;

    sv += value;
  }

  const solution =
    solve3x3(
      [
        [xx, xy, sx],
        [xy, yy, sy],
        [sx, sy, count]
      ],
      [
        xv,
        yv,
        sv
      ]
    );

  if (!solution) {
    return null;
  }

  const [a, b, c] =
    solution;

  return {
    a,
    b,
    c
  };
}


/* =========================================================
   RGB PLANE MODEL
========================================================= */

function fitRgbPlane(points) {
  const rModel =
    fitChannelPlane(
      points,
      'r'
    );

  const gModel =
    fitChannelPlane(
      points,
      'g'
    );

  const bModel =
    fitChannelPlane(
      points,
      'b'
    );

  if (
    !rModel ||
    !gModel ||
    !bModel
  ) {
    return null;
  }

  let baselineError = 0;
  let residualError = 0;

  const meanR =
    mean(points.map(p => p.r));

  const meanG =
    mean(points.map(p => p.g));

  const meanB =
    mean(points.map(p => p.b));

  for (const point of points) {
    const predictedR =
      rModel.a * point.x +
      rModel.b * point.y +
      rModel.c;

    const predictedG =
      gModel.a * point.x +
      gModel.b * point.y +
      gModel.c;

    const predictedB =
      bModel.a * point.x +
      bModel.b * point.y +
      bModel.c;

    const dr0 =
      point.r - meanR;

    const dg0 =
      point.g - meanG;

    const db0 =
      point.b - meanB;

    baselineError +=
      dr0 * dr0 +
      dg0 * dg0 +
      db0 * db0;

    const dr =
      point.r - predictedR;

    const dg =
      point.g - predictedG;

    const db =
      point.b - predictedB;

    residualError +=
      dr * dr +
      dg * dg +
      db * db;
  }

  let score = 0;

  if (
    baselineError >
    1e-9
  ) {
    score =
      1 -
      residualError /
      baselineError;
  }

  score =
    Math.max(
      0,
      Math.min(
        1,
        score
      )
    );

  const rmse =
    Math.sqrt(
      residualError /
      (
        points.length *
        3
      )
    );

  /*
   * Combined RGB spatial gradient vector.
   *
   * Direction choose karne ke liye R/G/B spatial
   * derivatives ko aggregate karte hain.
   */
  const gx =
    rModel.a * rModel.a +
    gModel.a * gModel.a +
    bModel.a * bModel.a;

  const gy =
    rModel.b * rModel.b +
    gModel.b * gModel.b +
    bModel.b * bModel.b;

  const cross =
    rModel.a * rModel.b +
    gModel.a * gModel.b +
    bModel.a * bModel.b;

  let angle =
    0.5 *
    Math.atan2(
      2 * cross,
      gx - gy
    );

  let dx =
    Math.cos(angle);

  let dy =
    Math.sin(angle);

  /*
   * Direction sign ko average brightness derivative
   * se make deterministic.
   */
  const brightnessDerivative =
    (
      0.2126 * rModel.a +
      0.7152 * gModel.a +
      0.0722 * bModel.a
    ) * dx
    +
    (
      0.2126 * rModel.b +
      0.7152 * gModel.b +
      0.0722 * bModel.b
    ) * dy;

  if (
    brightnessDerivative <
    0
  ) {
    dx = -dx;
    dy = -dy;

    angle +=
      Math.PI;
  }

  let degrees =
    angle *
    180 /
    Math.PI;

  while (degrees < 0) {
    degrees += 360;
  }

  while (degrees >= 360) {
    degrees -= 360;
  }

  return {
    rModel,
    gModel,
    bModel,
    score,
    rmse,
    angle: degrees,
    dx,
    dy
  };
}


/* =========================================================
   ENDPOINT COLORS
========================================================= */

function calculateEndpoints(
  points,
  model
) {
  const projected =
    points.map(
      point => ({
        point,

        position:
          point.x * model.dx +
          point.y * model.dy
      })
    );

  projected.sort(
    (a, b) =>
      a.position -
      b.position
  );

  /*
   * Extreme anti-aliasing/noise avoid karne ke liye
   * first/last 12% average.
   */
  const sampleCount =
    Math.max(
      1,
      Math.floor(
        projected.length *
        0.12
      )
    );

  const first =
    projected
      .slice(
        0,
        sampleCount
      )
      .map(item => item.point);

  const last =
    projected
      .slice(
        -sampleCount
      )
      .map(item => item.point);

  function averageColor(items) {
    return {
      r:
        mean(items.map(p => p.r)),

      g:
        mean(items.map(p => p.g)),

      b:
        mean(items.map(p => p.b))
    };
  }

  const startColor =
    averageColor(first);

  const endColor =
    averageColor(last);

  return {
    startColor,
    endColor,

    distance:
      colorDistance(
        startColor,
        endColor
      )
  };
}


/* =========================================================
   COLLECT ISOLATED PATH PIXELS
========================================================= */

async function collectPixels(
  original,
  originalInfo,
  maskPng
) {
  /*
   * Keep alpha here.
   *
   * Isolated mask has transparent background, so alpha
   * directly tells us target geometry.
   */
  const {
    data: mask,
    info
  } = await sharp(
    maskPng
  )
    .ensureAlpha()
    .raw()
    .toBuffer({
      resolveWithObject: true
    });

  if (
    info.width !== originalInfo.width ||
    info.height !== originalInfo.height
  ) {
    return null;
  }

  const points = [];

  const total =
    info.width *
    info.height;

  for (
    let i = 0;
    i < total;
    i++
  ) {
    const maskOffset =
      i * 4;

    const mr =
      mask[maskOffset];

    const mg =
      mask[maskOffset + 1];

    const mb =
      mask[maskOffset + 2];

    const alpha =
      mask[maskOffset + 3];

    /*
     * Only solid path interior.
     * Borders/anti-aliasing excluded.
     */
    if (
      alpha < 245 ||
      mr < 245 ||
      mg < 245 ||
      mb < 245
    ) {
      continue;
    }

    const imageOffset =
      i * 3;

    const x =
      i %
      info.width;

    const y =
      Math.floor(
        i /
        info.width
      );

    points.push({
      x,
      y,

      r:
        original[imageOffset],

      g:
        original[imageOffset + 1],

      b:
        original[imageOffset + 2]
    });
  }

  if (
    points.length <
    MIN_REGION_PIXELS
  ) {
    return null;
  }

  return points;
}


/* =========================================================
   ANALYSIS
========================================================= */

function analyzePoints(points) {
  const rStd =
    stdDev(
      points.map(p => p.r)
    );

  const gStd =
    stdDev(
      points.map(p => p.g)
    );

  const bStd =
    stdDev(
      points.map(p => p.b)
    );

  const variation =
    (
      rStd +
      gStd +
      bStd
    ) / 3;

  if (
    variation <
    MIN_COLOR_VARIATION
  ) {
    return {
      classification:
        'FLAT',

      variation,

      score: 0
    };
  }

  const model =
    fitRgbPlane(
      points
    );

  if (!model) {
    return {
      classification:
        'REJECT',

      variation,

      score: 0
    };
  }

  const endpoints =
    calculateEndpoints(
      points,
      model
    );

  let classification =
    'REJECT';

  if (
    endpoints.distance >=
    MIN_ENDPOINT_DISTANCE
  ) {
    if (
      model.score >=
      STRONG_SCORE
    ) {
      classification =
        'STRONG';

    } else if (
      model.score >=
      GOOD_SCORE
    ) {
      classification =
        'GOOD';

    } else if (
      model.score >=
      POSSIBLE_SCORE
    ) {
      classification =
        'POSSIBLE';
    }
  }

  return {
    classification,

    variation,

    score:
      model.score,

    rmse:
      model.rmse,

    angle:
      model.angle,

    endpointDistance:
      endpoints.distance,

    startColor:
      endpoints.startColor,

    endColor:
      endpoints.endColor
  };
}


/* =========================================================
   UTILITY
========================================================= */

function colorText(color) {
  if (!color) {
    return '-';
  }

  return (
    '(' +
    Math.round(color.r) +
    ',' +
    Math.round(color.g) +
    ',' +
    Math.round(color.b) +
    ')'
  );
}


/* =========================================================
   MAIN
========================================================= */

async function main() {
  const svgPath =
    process.argv[2];

  const imagePath =
    process.argv[3];

  if (
    !svgPath ||
    !imagePath
  ) {
    console.log(
      'Usage: node gradient-model-analyzer-v2.js our-current.svg test.jpg'
    );

    process.exit(1);
  }

  if (
    !fs.existsSync(svgPath)
  ) {
    throw new Error(
      `SVG nahi mili: ${svgPath}`
    );
  }

  if (
    !fs.existsSync(imagePath)
  ) {
    throw new Error(
      `Image nahi mili: ${imagePath}`
    );
  }

  const svg =
    fs.readFileSync(
      svgPath,
      'utf8'
    );

  const paths =
    getPathTags(
      svg
    );

  console.log('');
  console.log(
    '===================================================='
  );
  console.log(
    ' RGB GRADIENT MODEL ANALYSIS V2'
  );
  console.log(
    '===================================================='
  );

  console.log(
    `Total SVG paths: ${paths.length}`
  );


  /* -------------------------------------------------------
     ORIGINAL IMAGE
  ------------------------------------------------------- */

  const {
    data: original,
    info: originalInfo
  } = await sharp(
    imagePath
  )
    .rotate()
    .flatten({
      background:
        '#ffffff'
    })
    .resize({
      width:
        ANALYSIS_WIDTH
    })
    .removeAlpha()
    .raw()
    .toBuffer({
      resolveWithObject:
        true
    });

  console.log(
    `Analysis image: ${originalInfo.width}x${originalInfo.height}`
  );


  /* -------------------------------------------------------
     CANDIDATE LIST
  ------------------------------------------------------- */

  const candidates =
    paths
      .map(
        (
          tag,
          index
        ) => ({
          index,

          tag,

          fill:
            getFill(tag),

          chars:
            getPathData(tag).length
        })
      )

      .filter(
        item =>
          item.chars >=
            MIN_PATH_CHARS
          &&
          item.fill
          &&
          item.fill.toLowerCase() !==
            'none'
      )

      .sort(
        (a, b) =>
          b.chars -
          a.chars
      )

      .slice(
        0,
        MAX_CANDIDATES
      );


  console.log(
    `Preselected candidates: ${candidates.length}`
  );

  console.log(
    'Mask mode: isolated path'
  );

  console.log(
    'Color model: RGB spatial plane'
  );

  console.log('');


  /* -------------------------------------------------------
     ANALYZE
  ------------------------------------------------------- */

  const results = [];

  let processed = 0;


  for (
    const candidate of candidates
  ) {
    processed++;

    process.stdout.write(
      `\rAnalyzing ${processed}/${candidates.length}`
    );

    const maskSvg =
      buildIsolatedMaskSvg(
        svg,
        candidate.index
      );

    let maskPng;

    try {
      maskPng =
        renderSvg(
          maskSvg
        );
    } catch (error) {
      continue;
    }

    const points =
      await collectPixels(
        original,
        originalInfo,
        maskPng
      );

    if (!points) {
      continue;
    }

    const analysis =
      analyzePoints(
        points
      );

    results.push({
      ...candidate,

      pixels:
        points.length,

      ...analysis
    });
  }


  console.log('\n');


  /* -------------------------------------------------------
     SUMMARY
  ------------------------------------------------------- */

  const flat =
    results.filter(
      item =>
        item.classification ===
        'FLAT'
    );

  const strong =
    results.filter(
      item =>
        item.classification ===
        'STRONG'
    );

  const good =
    results.filter(
      item =>
        item.classification ===
        'GOOD'
    );

  const possible =
    results.filter(
      item =>
        item.classification ===
        'POSSIBLE'
    );

  const rejected =
    results.filter(
      item =>
        item.classification ===
        'REJECT'
    );


  console.log(
    '===================================================='
  );

  console.log(
    ' SUMMARY'
  );

  console.log(
    '===================================================='
  );

  console.log(
    `Useful analyzed: ${results.length}`
  );

  console.log(
    `FLAT:            ${flat.length}`
  );

  console.log(
    `STRONG:          ${strong.length}`
  );

  console.log(
    `GOOD:            ${good.length}`
  );

  console.log(
    `POSSIBLE:        ${possible.length}`
  );

  console.log(
    `REJECTED:        ${rejected.length}`
  );


  /* -------------------------------------------------------
     ACCEPTED / POSSIBLE
  ------------------------------------------------------- */

  console.log('');
  console.log(
    'TOP GRADIENT MODELS'
  );

  console.log(
    '----------------------------------------------------'
  );


  results
    .filter(
      item =>
        item.classification ===
          'STRONG'
        ||
        item.classification ===
          'GOOD'
        ||
        item.classification ===
          'POSSIBLE'
    )

    .sort(
      (a, b) =>
        b.score -
        a.score
    )

    .slice(
      0,
      40
    )

    .forEach(
      (
        item,
        rank
      ) => {
        console.log(
          `${String(rank + 1).padStart(2, ' ')}. ` +
          `path #${item.index} | ` +
          `${item.classification} | ` +
          `score=${item.score.toFixed(3)} | ` +
          `variation=${item.variation.toFixed(2)} | ` +
          `RMSE=${item.rmse.toFixed(2)} | ` +
          `colorΔ=${item.endpointDistance.toFixed(1)} | ` +
          `angle=${item.angle.toFixed(1)}° | ` +
          `pixels=${item.pixels} | ` +
          `${colorText(item.startColor)} -> ` +
          `${colorText(item.endColor)}`
        );
      }
    );


  /* -------------------------------------------------------
     BEST REJECTED
  ------------------------------------------------------- */

  console.log('');
  console.log(
    'BORDERLINE / BEST REJECTED'
  );

  console.log(
    '----------------------------------------------------'
  );


  rejected
    .sort(
      (a, b) =>
        b.score -
        a.score
    )

    .slice(
      0,
      20
    )

    .forEach(
      (
        item,
        rank
      ) => {
        console.log(
          `${String(rank + 1).padStart(2, ' ')}. ` +
          `path #${item.index} | ` +
          `score=${item.score.toFixed(3)} | ` +
          `variation=${item.variation.toFixed(2)} | ` +
          `RMSE=${item.rmse.toFixed(2)} | ` +
          `colorΔ=${item.endpointDistance.toFixed(1)} | ` +
          `pixels=${item.pixels}`
        );
      }
    );


  /* -------------------------------------------------------
     PATH #40 SANITY CHECK
  ------------------------------------------------------- */

  const oldWinner =
    results.find(
      item =>
        item.index === 40
    );

  console.log('');
  console.log(
    'OLD PATH #40 SANITY CHECK'
  );

  console.log(
    '----------------------------------------------------'
  );

  if (oldWinner) {
    console.log(
      `classification=${oldWinner.classification} | ` +
      `score=${oldWinner.score.toFixed(3)} | ` +
      `variation=${oldWinner.variation.toFixed(2)} | ` +
      `pixels=${oldWinner.pixels}`
    );
  } else {
    console.log(
      'Path #40 useful analyzed set mein nahi mila.'
    );
  }


  console.log('');
  console.log(
    '===================================================='
  );

  console.log(
    ' V2 analysis complete'
  );

  console.log(
    '===================================================='
  );

  console.log('');
}


/* =========================================================
   START
========================================================= */

main().catch(
  error => {
    console.error(error);

    process.exit(1);
  }
);