const fs = require('fs');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');


/* =========================================================
   CONFIG
========================================================= */

const ANALYSIS_WIDTH = 500;

const MIN_REGION_PIXELS = 250;
const MIN_SAFE_RATIO = 0.82;

const MIN_VARIATION = 4.0;

const STRONG_SCORE = 0.72;
const GOOD_SCORE = 0.58;
const POSSIBLE_SCORE = 0.45;

const MIN_ENDPOINT_DISTANCE = 10;

const MAX_PATHS = 1232;

const JSON_OUTPUT =
  'safe-gradient-results.json';


/* =========================================================
   SVG HELPERS
========================================================= */

function getPaths(svg) {

  return svg.match(
    /<path\b[^>]*>/gi
  ) || [];
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


/* =========================================================
   FORCE PATH WHITE
========================================================= */

function forceWhiteFill(tag) {

  let result = tag;


  result = result.replace(

    /\bstyle\s*=\s*["']([^"']*)["']/i,

    (
      full,
      style
    ) => {

      let clean =
        style.replace(
          /(?:^|;)\s*fill\s*:\s*[^;]*/gi,
          ''
        );


      clean =
        clean
          .split(';')
          .map(
            value =>
              value.trim()
          )
          .filter(
            Boolean
          )
          .join(';');


      if (clean) {

        clean += ';';
      }


      clean +=
        'fill:#ffffff';


      return (
        `style="${clean}"`
      );
    }
  );


  if (
    /\bfill\s*=\s*["'][^"']*["']/i
      .test(
        result
      )
  ) {

    result =
      result.replace(
        /\bfill\s*=\s*["'][^"']*["']/i,
        'fill="#ffffff"'
      );

  } else {

    result =
      result.replace(

        /\/?>$/,

        ending => {

          if (
            ending === '/>'
          ) {

            return (
              ' fill="#ffffff"/>'
            );
          }


          return (
            ' fill="#ffffff">'
          );
        }
      );
  }


  if (
    /\bstroke\s*=\s*["'][^"']*["']/i
      .test(
        result
      )
  ) {

    result =
      result.replace(
        /\bstroke\s*=\s*["'][^"']*["']/i,
        'stroke="none"'
      );
  }


  return result;
}


/* =========================================================
   ISOLATED PATH SVG
========================================================= */

function buildPathMaskSvg(
  svg,
  targetIndex
) {

  let current =
    -1;


  return svg.replace(

    /<path\b[^>]*>/gi,

    tag => {

      current++;


      if (
        current ===
        targetIndex
      ) {

        return forceWhiteFill(
          tag
        );
      }


      return '';
    }
  );
}


/* =========================================================
   SVG RENDER
========================================================= */

function renderSvg(svg) {

  const resvg =
    new Resvg(
      svg,
      {

        fitTo: {

          mode:
            'width',

          value:
            ANALYSIS_WIDTH
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

  if (
    !values.length
  ) {

    return 0;
  }


  let total =
    0;


  for (
    const value of
    values
  ) {

    total +=
      value;
  }


  return (
    total /
    values.length
  );
}


function stdDev(values) {

  if (
    values.length <
    2
  ) {

    return 0;
  }


  const average =
    mean(
      values
    );


  let total =
    0;


  for (
    const value of
    values
  ) {

    const difference =
      value -
      average;


    total +=
      difference *
      difference;
  }


  return Math.sqrt(
    total /
    values.length
  );
}


function colorDistance(
  a,
  b
) {

  const dr =
    a.r -
    b.r;

  const dg =
    a.g -
    b.g;

  const db =
    a.b -
    b.b;


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
      row =>
        row.slice()
    );


  const b =
    values.slice();


  for (
    let column = 0;
    column < 3;
    column++
  ) {

    let pivot =
      column;


    for (
      let row =
        column + 1;

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

        pivot =
          row;
      }
    }


    if (
      Math.abs(
        a[pivot][column]
      )
      <
      1e-10
    ) {

      return null;
    }


    [
      a[column],
      a[pivot]
    ] =
    [
      a[pivot],
      a[column]
    ];


    [
      b[column],
      b[pivot]
    ] =
    [
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

      if (
        row === column
      ) {

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
   FIT RGB CHANNEL
========================================================= */

function fitChannel(
  points,
  channel
) {

  let xx = 0;
  let xy = 0;
  let yy = 0;

  let x = 0;
  let y = 0;

  let xv = 0;
  let yv = 0;

  let v = 0;


  const count =
    points.length;


  for (
    const point of
    points
  ) {

    const value =
      point[channel];


    xx +=
      point.x *
      point.x;

    xy +=
      point.x *
      point.y;

    yy +=
      point.y *
      point.y;


    x +=
      point.x;

    y +=
      point.y;


    xv +=
      point.x *
      value;

    yv +=
      point.y *
      value;

    v +=
      value;
  }


  const solution =
    solve3x3(

      [
        [xx, xy, x],
        [xy, yy, y],
        [x, y, count]
      ],

      [
        xv,
        yv,
        v
      ]
    );


  if (
    !solution
  ) {

    return null;
  }


  return {

    a:
      solution[0],

    b:
      solution[1],

    c:
      solution[2]
  };
}


/* =========================================================
   RGB MODEL
========================================================= */

function fitRgbModel(
  points
) {

  const rModel =
    fitChannel(
      points,
      'r'
    );


  const gModel =
    fitChannel(
      points,
      'g'
    );


  const bModel =
    fitChannel(
      points,
      'b'
    );


  if (
    !rModel
    ||
    !gModel
    ||
    !bModel
  ) {

    return null;
  }


  const averageR =
    mean(
      points.map(
        p =>
          p.r
      )
    );


  const averageG =
    mean(
      points.map(
        p =>
          p.g
      )
    );


  const averageB =
    mean(
      points.map(
        p =>
          p.b
      )
    );


  let baselineError =
    0;


  let modelError =
    0;


  for (
    const point of
    points
  ) {

    const pr =
      rModel.a *
      point.x
      +
      rModel.b *
      point.y
      +
      rModel.c;


    const pg =
      gModel.a *
      point.x
      +
      gModel.b *
      point.y
      +
      gModel.c;


    const pb =
      bModel.a *
      point.x
      +
      bModel.b *
      point.y
      +
      bModel.c;


    baselineError +=

      (
        point.r -
        averageR
      ) ** 2

      +

      (
        point.g -
        averageG
      ) ** 2

      +

      (
        point.b -
        averageB
      ) ** 2;


    modelError +=

      (
        point.r -
        pr
      ) ** 2

      +

      (
        point.g -
        pg
      ) ** 2

      +

      (
        point.b -
        pb
      ) ** 2;
  }


  let score =
    0;


  if (
    baselineError >
    1e-9
  ) {

    score =
      1 -
      (
        modelError /
        baselineError
      );
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

      modelError
      /
      (
        points.length *
        3
      )
    );


  const gx =

    rModel.a *
    rModel.a

    +

    gModel.a *
    gModel.a

    +

    bModel.a *
    bModel.a;


  const gy =

    rModel.b *
    rModel.b

    +

    gModel.b *
    gModel.b

    +

    bModel.b *
    bModel.b;


  const cross =

    rModel.a *
    rModel.b

    +

    gModel.a *
    gModel.b

    +

    bModel.a *
    bModel.b;


  let angle =
    0.5 *
    Math.atan2(
      2 *
      cross,

      gx -
      gy
    );


  const dx =
    Math.cos(
      angle
    );


  const dy =
    Math.sin(
      angle
    );


  let degrees =

    angle *
    180 /
    Math.PI;


  if (
    degrees <
    0
  ) {

    degrees +=
      360;
  }


  return {

    score,

    rmse,

    angle:
      degrees,

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

        t:
          point.x *
          model.dx
          +
          point.y *
          model.dy

      })
    );


  projected.sort(
    (
      a,
      b
    ) =>
      a.t -
      b.t
  );


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
      .map(
        item =>
          item.point
      );


  const last =
    projected
      .slice(
        -sampleCount
      )
      .map(
        item =>
          item.point
      );


  function averageColor(
    items
  ) {

    return {

      r:
        mean(
          items.map(
            p =>
              p.r
          )
        ),

      g:
        mean(
          items.map(
            p =>
              p.g
          )
        ),

      b:
        mean(
          items.map(
            p =>
              p.b
          )
        )
    };
  }


  const start =
    averageColor(
      first
    );


  const end =
    averageColor(
      last
    );


  return {

    start,

    end,

    distance:
      colorDistance(
        start,
        end
      )
  };
}


/* =========================================================
   COLLECT PATH PIXELS
========================================================= */

async function collectPathData(
  original,
  originalInfo,
  safeMask,
  safeInfo,
  maskPng
) {

  const {
    data: mask,
    info: maskInfo
  } =
    await sharp(
      maskPng
    )

      .ensureAlpha()

      .raw()

      .toBuffer({
        resolveWithObject:
          true
      });


  if (
    maskInfo.width !==
      originalInfo.width

    ||

    maskInfo.height !==
      originalInfo.height

    ||

    safeInfo.width !==
      originalInfo.width

    ||

    safeInfo.height !==
      originalInfo.height
  ) {

    return null;
  }


  const points =
    [];


  let regionPixels =
    0;


  let safePixels =
    0;


  const total =
    maskInfo.width *
    maskInfo.height;


  for (
    let i = 0;
    i < total;
    i++
  ) {

    const maskOffset =
      i *
      4;


    const alpha =
      mask[
        maskOffset +
        3
      ];


    const mr =
      mask[
        maskOffset
      ];


    const mg =
      mask[
        maskOffset +
        1
      ];


    const mb =
      mask[
        maskOffset +
        2
      ];


    if (
      alpha <
        245

      ||

      mr <
        245

      ||

      mg <
        245

      ||

      mb <
        245
    ) {

      continue;
    }


    regionPixels++;


    const safeValue =
      safeMask[
        i
      ];


    if (
      safeValue <
      180
    ) {

      continue;
    }


    safePixels++;


    const imageOffset =
      i *
      3;


    const x =
      i %
      maskInfo.width;


    const y =
      Math.floor(
        i /
        maskInfo.width
      );


    points.push({

      x,

      y,

      r:
        original[
          imageOffset
        ],

      g:
        original[
          imageOffset +
          1
        ],

      b:
        original[
          imageOffset +
          2
        ]
    });
  }


  if (
    regionPixels <
    MIN_REGION_PIXELS
  ) {

    return null;
  }


  return {

    regionPixels,

    safePixels,

    safeRatio:
      safePixels /
      regionPixels,

    points
  };
}


/* =========================================================
   ANALYZE PATH
========================================================= */

function analyzePath(
  collected
) {

  const {
    points,
    safeRatio
  } =
    collected;


  if (
    safeRatio <
    MIN_SAFE_RATIO
  ) {

    return {

      classification:
        'DETAIL_REJECT',

      safeRatio
    };
  }


  if (
    points.length <
    MIN_REGION_PIXELS
  ) {

    return {

      classification:
        'SMALL_SAFE',

      safeRatio
    };
  }


  const rStd =
    stdDev(
      points.map(
        p =>
          p.r
      )
    );


  const gStd =
    stdDev(
      points.map(
        p =>
          p.g
      )
    );


  const bStd =
    stdDev(
      points.map(
        p =>
          p.b
      )
    );


  const variation =

    (
      rStd +
      gStd +
      bStd
    )

    /
    3;


  if (
    variation <
    MIN_VARIATION
  ) {

    return {

      classification:
        'FLAT',

      safeRatio,

      variation
    };
  }


  const model =
    fitRgbModel(
      points
    );


  if (
    !model
  ) {

    return {

      classification:
        'MODEL_REJECT',

      safeRatio,

      variation
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

    safeRatio,

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
      endpoints.start,

    endColor:
      endpoints.end
  };
}


/* =========================================================
   FORMAT COLOR
========================================================= */

function colorText(
  color
) {

  if (
    !color
  ) {

    return '-';
  }


  return (

    '(' +

    Math.round(
      color.r
    )

    +

    ',' +

    Math.round(
      color.g
    )

    +

    ',' +

    Math.round(
      color.b
    )

    +

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


  const safeMaskPath =
    process.argv[4];


  if (
    !svgPath
    ||
    !imagePath
    ||
    !safeMaskPath
  ) {

    console.log(
      'Usage: node safe-gradient-analyzer.js our-current.svg test.jpg gradient-safe-mask.png'
    );


    process.exit(
      1
    );
  }


  for (
    const file of
    [
      svgPath,
      imagePath,
      safeMaskPath
    ]
  ) {

    if (
      !fs.existsSync(
        file
      )
    ) {

      throw new Error(
        `File nahi mili: ${file}`
      );
    }
  }


  const svg =
    fs.readFileSync(
      svgPath,
      'utf8'
    );


  const paths =
    getPaths(
      svg
    );


  console.log('');
  console.log(
    '===================================================='
  );

  console.log(
    ' SAFE GRADIENT ANALYZER'
  );

  console.log(
    '===================================================='
  );


  console.log(
    `SVG paths: ${paths.length}`
  );


  /* -------------------------------------------------------
     ORIGINAL RASTER
  ------------------------------------------------------- */

  const {
    data: original,
    info: originalInfo
  } =
    await sharp(
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


  /* -------------------------------------------------------
     SAFE MASK
  ------------------------------------------------------- */

  const {
    data: safeMask,
    info: safeInfo
  } =
    await sharp(
      safeMaskPath
    )

      .resize({
        width:
          originalInfo.width,

        height:
          originalInfo.height,

        fit:
          'fill',

        kernel:
          'nearest'
      })

      .greyscale()

      .raw()

      .toBuffer({
        resolveWithObject:
          true
      });


  console.log(
    `Analysis: ${originalInfo.width}x${originalInfo.height}`
  );


  console.log(
    `Minimum safe ratio: ${(MIN_SAFE_RATIO * 100).toFixed(0)}%`
  );


  console.log('');


  /* -------------------------------------------------------
     ANALYZE PATHS
  ------------------------------------------------------- */

  const results =
    [];


  const limit =
    Math.min(
      paths.length,
      MAX_PATHS
    );


  for (
    let index = 0;
    index < limit;
    index++
  ) {

    process.stdout.write(
      `\rAnalyzing path ${index + 1}/${limit}`
    );


    const fill =
      getFill(
        paths[index]
      );


    if (
      !fill
      ||
      fill.toLowerCase() ===
        'none'
    ) {

      continue;
    }


    const maskSvg =
      buildPathMaskSvg(
        svg,
        index
      );


    let maskPng;


    try {

      maskPng =
        renderSvg(
          maskSvg
        );

    } catch {

      continue;
    }


    const collected =
      await collectPathData(

        original,

        originalInfo,

        safeMask,

        safeInfo,

        maskPng
      );


    if (
      !collected
    ) {

      continue;
    }


    const analysis =
      analyzePath(
        collected
      );


    results.push({

      index,

      fill,

      pixels:
        collected.regionPixels,

      safePixels:
        collected.safePixels,

      ...analysis
    });
  }


  console.log('\n');


  /* -------------------------------------------------------
     COUNTS
  ------------------------------------------------------- */

  function count(
    type
  ) {

    return results.filter(
      item =>
        item.classification ===
        type
    ).length;
  }


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
    `Useful paths:   ${results.length}`
  );

  console.log(
    `DETAIL reject:  ${count('DETAIL_REJECT')}`
  );

  console.log(
    `SMALL safe:     ${count('SMALL_SAFE')}`
  );

  console.log(
    `FLAT:           ${count('FLAT')}`
  );

  console.log(
    `STRONG:         ${count('STRONG')}`
  );

  console.log(
    `GOOD:           ${count('GOOD')}`
  );

  console.log(
    `POSSIBLE:       ${count('POSSIBLE')}`
  );

  console.log(
    `REJECT:         ${count('REJECT')}`
  );


  /* -------------------------------------------------------
     ACCEPTED
  ------------------------------------------------------- */

  const accepted =
    results.filter(
      item =>

        item.classification ===
          'STRONG'

        ||

        item.classification ===
          'GOOD'

        ||

        item.classification ===
          'POSSIBLE'
    );


  accepted.sort(
    (
      a,
      b
    ) =>
      b.score -
      a.score
  );


  console.log('');
  console.log(
    'TOP SAFE GRADIENT CANDIDATES'
  );

  console.log(
    '----------------------------------------------------'
  );


  accepted
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

          `safe=${(item.safeRatio * 100).toFixed(1)}% | ` +

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
     BORDERLINE
  ------------------------------------------------------- */

  const borderline =
    results

      .filter(
        item =>

          item.classification ===
          'REJECT'

          &&

          typeof item.score ===
          'number'
      )

      .sort(
        (
          a,
          b
        ) =>
          b.score -
          a.score
      );


  console.log('');
  console.log(
    'BEST REJECTED MODELS'
  );

  console.log(
    '----------------------------------------------------'
  );


  borderline
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

          `safe=${(item.safeRatio * 100).toFixed(1)}% | ` +

          `score=${item.score.toFixed(3)} | ` +

          `variation=${item.variation.toFixed(2)} | ` +

          `colorΔ=${item.endpointDistance.toFixed(1)} | ` +

          `pixels=${item.pixels}`

        );
      }
    );


  /* =======================================================
     SAVE ACCEPTED RESULTS TO JSON
  ======================================================= */

  const jsonResults =
    accepted.map(
      item => ({

        index:
          item.index,

        fill:
          item.fill,

        classification:
          item.classification,

        pixels:
          item.pixels,

        safePixels:
          item.safePixels,

        safeRatio:
          item.safeRatio,

        variation:
          item.variation,

        score:
          item.score,

        rmse:
          item.rmse,

        angle:
          item.angle,

        endpointDistance:
          item.endpointDistance,

        startColor:
          item.startColor,

        endColor:
          item.endColor

      })
    );


  fs.writeFileSync(

    JSON_OUTPUT,

    JSON.stringify(
      jsonResults,
      null,
      2
    ),

    'utf8'
  );


  console.log('');

  console.log(
    `Saved candidates: ${JSON_OUTPUT} (${jsonResults.length})`
  );


  console.log('');
  console.log(
    '===================================================='
  );

  console.log(
    ' Safe gradient analysis complete'
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

    console.error(
      error
    );

    process.exit(
      1
    );
  }
);