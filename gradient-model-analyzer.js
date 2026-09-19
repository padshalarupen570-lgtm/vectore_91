const fs = require('fs');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');


/* =========================================================
   CONFIG
========================================================= */

const ANALYSIS_WIDTH = 500;

const MIN_PATH_CHARS = 250;
const MAX_CANDIDATES = 60;
const MIN_REGION_PIXELS = 300;

const MIN_VARIATION = 4.0;

/*
 * Model-quality thresholds.
 *
 * 0.60 = promising enough for further testing.
 * 0.72 = strong/high-confidence fit.
 */
const GOOD_FIT = 0.60;
const STRONG_FIT = 0.72;


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

  return match
    ? match[1]
    : '';
}


function getFill(tag) {
  let match = tag.match(
    /\bfill\s*=\s*["']([^"']+)["']/i
  );

  if (match) {
    return match[1];
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


function replaceFill(
  tag,
  color
) {
  if (
    /\bfill\s*=\s*["'][^"']+["']/i.test(
      tag
    )
  ) {
    return tag.replace(
      /\bfill\s*=\s*["'][^"']+["']/i,
      `fill="${color}"`
    );
  }

  return tag.replace(
    /\/?>$/,
    ending => {
      if (ending === '/>') {
        return ` fill="${color}"/>`;
      }

      return ` fill="${color}">`;
    }
  );
}


function buildMaskSvg(
  svg,
  targetIndex
) {
  let index = -1;

  return svg.replace(
    /<path\b[^>]*>/gi,
    tag => {
      index++;

      return replaceFill(
        tag,
        index === targetIndex
          ? '#ffffff'
          : '#000000'
      );
    }
  );
}


/* =========================================================
   RENDER SVG
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
   BASIC MATH
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


function variance(values) {
  if (values.length < 2) {
    return 0;
  }

  const avg = mean(values);

  let value = 0;

  for (const item of values) {
    const difference =
      item - avg;

    value +=
      difference * difference;
  }

  return value / values.length;
}


function stdDev(values) {
  return Math.sqrt(
    variance(values)
  );
}


function luminance(
  r,
  g,
  b
) {
  return (
    0.2126 * r +
    0.7152 * g +
    0.0722 * b
  );
}


/* =========================================================
   3x3 LINEAR SYSTEM
========================================================= */

function solve3x3(
  matrix,
  values
) {
  const a = matrix.map(
    row => row.slice()
  );

  const b = values.slice();

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
        Math.abs(
          a[row][column]
        )
        >
        Math.abs(
          a[pivot][column]
        )
      ) {
        pivot = row;
      }
    }

    if (
      Math.abs(
        a[pivot][column]
      ) < 1e-9
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
   R²
========================================================= */

function calculateR2(
  actual,
  predicted
) {
  if (!actual.length) {
    return 0;
  }

  const average =
    mean(actual);

  let total = 0;
  let residual = 0;

  for (
    let i = 0;
    i < actual.length;
    i++
  ) {
    const totalDiff =
      actual[i] -
      average;

    const residualDiff =
      actual[i] -
      predicted[i];

    total +=
      totalDiff *
      totalDiff;

    residual +=
      residualDiff *
      residualDiff;
  }

  if (total <= 1e-9) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      1,
      1 -
      residual / total
    )
  );
}


/* =========================================================
   COLLECT PATH PIXELS
========================================================= */

async function collectPixels(
  original,
  originalInfo,
  maskPng
) {
  const {
    data: mask,
    info
  } = await sharp(
    maskPng
  )
    .removeAlpha()
    .raw()
    .toBuffer({
      resolveWithObject: true
    });

  if (
    info.width !==
      originalInfo.width
    ||
    info.height !==
      originalInfo.height
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
    const offset =
      i * 3;

    if (
      mask[offset] < 245 ||
      mask[offset + 1] < 245 ||
      mask[offset + 2] < 245
    ) {
      continue;
    }

    const x =
      i %
      info.width;

    const y =
      Math.floor(
        i /
        info.width
      );

    const r =
      original[offset];

    const g =
      original[offset + 1];

    const b =
      original[offset + 2];

    points.push({
      x,
      y,
      r,
      g,
      b,
      l:
        luminance(
          r,
          g,
          b
        )
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
   ARBITRARY-ANGLE / PLANE MODEL
========================================================= */

/*
 * Fits:
 *
 * L = A*x + B*y + C
 *
 * Unlike previous analyzer, gradient direction can
 * be any angle rather than only horizontal/vertical.
 */

function fitPlane(points) {
  let xx = 0;
  let xy = 0;
  let yy = 0;

  let x = 0;
  let y = 0;

  let xl = 0;
  let yl = 0;

  let l = 0;

  const count =
    points.length;

  for (
    const point of points
  ) {
    xx +=
      point.x *
      point.x;

    xy +=
      point.x *
      point.y;

    yy +=
      point.y *
      point.y;

    x += point.x;
    y += point.y;

    xl +=
      point.x *
      point.l;

    yl +=
      point.y *
      point.l;

    l += point.l;
  }

  const solution =
    solve3x3(
      [
        [xx, xy, x],
        [xy, yy, y],
        [x, y, count]
      ],
      [
        xl,
        yl,
        l
      ]
    );

  if (!solution) {
    return {
      r2: 0
    };
  }

  const [
    a,
    b,
    c
  ] = solution;

  const actual = [];
  const predicted = [];

  for (
    const point of points
  ) {
    actual.push(
      point.l
    );

    predicted.push(
      a * point.x +
      b * point.y +
      c
    );
  }

  const r2 =
    calculateR2(
      actual,
      predicted
    );

  let angle =
    Math.atan2(
      b,
      a
    )
    *
    180 /
    Math.PI;

  if (angle < 0) {
    angle += 360;
  }

  return {
    r2,
    a,
    b,
    c,
    angle
  };
}


/* =========================================================
   RADIAL MODEL
========================================================= */

/*
 * Estimate a brightness-weighted center, then fit:
 *
 * L = A * radius + B
 *
 * We try both:
 * - bright center
 * - dark center
 *
 * because some regions darken outward and others
 * brighten outward.
 */

function fitRadialFromCenter(
  points,
  centerX,
  centerY
) {
  const radii = [];
  const values = [];

  for (
    const point of points
  ) {
    const dx =
      point.x -
      centerX;

    const dy =
      point.y -
      centerY;

    radii.push(
      Math.sqrt(
        dx * dx +
        dy * dy
      )
    );

    values.push(
      point.l
    );
  }

  const meanR =
    mean(radii);

  const meanL =
    mean(values);

  let numerator = 0;
  let denominator = 0;

  for (
    let i = 0;
    i < radii.length;
    i++
  ) {
    const dr =
      radii[i] -
      meanR;

    numerator +=
      dr *
      (
        values[i] -
        meanL
      );

    denominator +=
      dr *
      dr;
  }

  if (
    denominator <=
    1e-9
  ) {
    return {
      r2: 0
    };
  }

  const slope =
    numerator /
    denominator;

  const intercept =
    meanL -
    slope *
    meanR;

  const predicted =
    radii.map(
      radius =>
        slope *
        radius +
        intercept
    );

  return {
    r2:
      calculateR2(
        values,
        predicted
      ),

    slope,
    intercept,
    centerX,
    centerY
  };
}


function weightedCenter(
  points,
  bright
) {
  let minimum =
    Infinity;

  let maximum =
    -Infinity;

  for (
    const point of points
  ) {
    minimum =
      Math.min(
        minimum,
        point.l
      );

    maximum =
      Math.max(
        maximum,
        point.l
      );
  }

  let weightedX = 0;
  let weightedY = 0;
  let weightTotal = 0;

  for (
    const point of points
  ) {
    let weight;

    if (bright) {
      weight =
        point.l -
        minimum +
        1;
    } else {
      weight =
        maximum -
        point.l +
        1;
    }

    /*
     * Squared weighting pulls center toward
     * strongest light/dark region.
     */
    weight *=
      weight;

    weightedX +=
      point.x *
      weight;

    weightedY +=
      point.y *
      weight;

    weightTotal +=
      weight;
  }

  if (
    weightTotal <=
    0
  ) {
    return null;
  }

  return {
    x:
      weightedX /
      weightTotal,

    y:
      weightedY /
      weightTotal
  };
}


function fitRadial(points) {
  const brightCenter =
    weightedCenter(
      points,
      true
    );

  const darkCenter =
    weightedCenter(
      points,
      false
    );

  const candidates = [];

  if (brightCenter) {
    candidates.push(
      fitRadialFromCenter(
        points,
        brightCenter.x,
        brightCenter.y
      )
    );
  }

  if (darkCenter) {
    candidates.push(
      fitRadialFromCenter(
        points,
        darkCenter.x,
        darkCenter.y
      )
    );
  }

  candidates.sort(
    (a, b) =>
      b.r2 -
      a.r2
  );

  return (
    candidates[0]
    ||
    {
      r2: 0
    }
  );
}


/* =========================================================
   ANALYZE MODELS
========================================================= */

function analyzeModels(
  points
) {
  const luminances =
    points.map(
      point =>
        point.l
    );

  const variation =
    stdDev(
      luminances
    );

  if (
    variation <
    MIN_VARIATION
  ) {
    return {
      type:
        'FLAT',

      variation,

      score: 0
    };
  }

  const plane =
    fitPlane(
      points
    );

  const radial =
    fitRadial(
      points
    );

  let model;
  let score;

  if (
    plane.r2 >=
    radial.r2
  ) {
    model =
      'LINEAR';

    score =
      plane.r2;
  } else {
    model =
      'RADIAL';

    score =
      radial.r2;
  }

  let confidence =
    'REJECT';

  if (
    score >=
    STRONG_FIT
  ) {
    confidence =
      'STRONG';
  } else if (
    score >=
    GOOD_FIT
  ) {
    confidence =
      'GOOD';
  }

  return {
    type:
      model,

    confidence,

    score,

    variation,

    plane,

    radial
  };
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
      'Usage: node gradient-model-analyzer.js our-current.svg test.jpg'
    );

    process.exit(1);
  }

  if (
    !fs.existsSync(
      svgPath
    )
  ) {
    throw new Error(
      `SVG nahi mili: ${svgPath}`
    );
  }

  if (
    !fs.existsSync(
      imagePath
    )
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
    '=========================================='
  );

  console.log(
    ' ADVANCED GRADIENT MODEL ANALYSIS'
  );

  console.log(
    '=========================================='
  );

  console.log(
    `Total SVG paths: ${paths.length}`
  );


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


  const candidates =
    paths
      .map(
        (
          tag,
          index
        ) => {
          return {
            index,
            tag,
            fill:
              getFill(tag),
            chars:
              getPathData(
                tag
              ).length
          };
        }
      )

      .filter(
        item =>
          item.chars >=
            MIN_PATH_CHARS
          &&
          item.fill
          &&
          item.fill !==
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
    `Candidates: ${candidates.length}`
  );


  const results = [];

  let count = 0;


  for (
    const candidate of
    candidates
  ) {
    count++;

    process.stdout.write(
      `\rAnalyzing ${count}/${candidates.length}`
    );

    const maskSvg =
      buildMaskSvg(
        svg,
        candidate.index
      );

    let mask;

    try {
      mask =
        renderSvg(
          maskSvg
        );
    } catch {
      continue;
    }

    const points =
      await collectPixels(
        original,
        originalInfo,
        mask
      );

    if (!points) {
      continue;
    }

    const analysis =
      analyzeModels(
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


  const flat =
    results.filter(
      item =>
        item.type ===
        'FLAT'
    );


  const strong =
    results.filter(
      item =>
        item.confidence ===
        'STRONG'
    );


  const good =
    results.filter(
      item =>
        item.confidence ===
        'GOOD'
    );


  const rejected =
    results.filter(
      item =>
        item.confidence ===
        'REJECT'
    );


  const linear =
    results.filter(
      item =>
        item.type ===
        'LINEAR'
      &&
      item.confidence !==
        'REJECT'
    );


  const radial =
    results.filter(
      item =>
        item.type ===
        'RADIAL'
      &&
      item.confidence !==
        'REJECT'
    );


  console.log(
    `Useful analyzed: ${results.length}`
  );

  console.log(
    `FLAT:            ${flat.length}`
  );

  console.log(
    `STRONG models:   ${strong.length}`
  );

  console.log(
    `GOOD models:     ${good.length}`
  );

  console.log(
    `REJECTED:        ${rejected.length}`
  );

  console.log(
    `Accepted LINEAR: ${linear.length}`
  );

  console.log(
    `Accepted RADIAL: ${radial.length}`
  );


  console.log('');
  console.log(
    'TOP ACCEPTED MODELS'
  );

  console.log(
    '------------------------------------------'
  );


  results
    .filter(
      item =>
        item.confidence ===
          'STRONG'
        ||
        item.confidence ===
          'GOOD'
    )

    .sort(
      (
        a,
        b
      ) => {

        /*
         * Large region first,
         * confidence score second.
         */
        return (
          b.pixels -
          a.pixels
        )
        ||
        (
          b.score -
          a.score
        );
      }
    )

    .slice(
      0,
      30
    )

    .forEach(
      (
        item,
        rank
      ) => {

        let extra =
          '';

        if (
          item.type ===
          'LINEAR'
        ) {
          extra =
            `angle=${item.plane.angle.toFixed(1)}°`;
        }

        if (
          item.type ===
          'RADIAL'
        ) {
          extra =
            `center=(${item.radial.centerX.toFixed(0)},${item.radial.centerY.toFixed(0)})`;
        }

        console.log(

          `${String(rank + 1)
            .padStart(2, ' ')}. ` +

          `path #${item.index} | ` +

          `${item.type} | ` +

          `${item.confidence} | ` +

          `score=${item.score.toFixed(3)} | ` +

          `variation=${item.variation.toFixed(2)} | ` +

          `pixels=${item.pixels} | ` +

          `${extra}`

        );
      }
    );


  console.log('');
  console.log(
    '=========================================='
  );

  console.log(
    ' Advanced gradient analysis complete'
  );

  console.log(
    '=========================================='
  );

  console.log('');
}


main().catch(
  error => {

    console.error(
      error
    );

    process.exit(
      1
    );
  }
);