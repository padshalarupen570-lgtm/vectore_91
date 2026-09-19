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

/*
 * Region mein minimum actual color variation.
 */
const MIN_VARIATION = 4.0;


/*
 * Fit score:
 *
 * 1.0 = extremely clean gradient
 * 0.0 = gradient model useless
 */
const SAFE_FIT_SCORE = 0.72;

const POSSIBLE_FIT_SCORE = 0.55;


/*
 * Gradient ke start/end colors mein minimum difference.
 *
 * Agar difference bahut low hai to flat fill enough hai.
 */
const MIN_ENDPOINT_DISTANCE = 7;


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

      if (
        ending === '/>'
      ) {
        return ` fill="${color}"/>`;
      }


      return ` fill="${color}">`;
    }
  );
}


/* =========================================================
   PATH MASK
========================================================= */

function buildMaskSvg(
  svg,
  targetIndex
) {

  let pathIndex =
    -1;


  return svg.replace(

    /<path\b[^>]*>/gi,

    tag => {

      pathIndex++;


      if (
        pathIndex ===
        targetIndex
      ) {

        return replaceFill(
          tag,
          '#ffffff'
        );
      }


      return replaceFill(
        tag,
        '#000000'
      );
    }
  );
}


/* =========================================================
   RENDER
========================================================= */

function renderSvg(
  svg
) {

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
   MATH HELPERS
========================================================= */

function mean(
  values
) {

  if (
    !values.length
  ) {
    return 0;
  }


  let total =
    0;


  for (
    const value of values
  ) {

    total +=
      value;
  }


  return (
    total /
    values.length
  );
}


function variance(
  values
) {

  if (
    values.length <
    2
  ) {
    return 0;
  }


  const avg =
    mean(
      values
    );


  let total =
    0;


  for (
    const value of values
  ) {

    const difference =
      value -
      avg;


    total +=
      difference *
      difference;
  }


  return (
    total /
    values.length
  );
}


function stdDev(
  values
) {

  return Math.sqrt(
    variance(
      values
    )
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
   LINEAR REGRESSION
========================================================= */

function linearRegression(
  xs,
  ys
) {

  const count =
    xs.length;


  if (
    count <
    2
  ) {

    return {
      slope: 0,
      intercept: 0,
      r2: 0
    };
  }


  const meanX =
    mean(
      xs
    );

  const meanY =
    mean(
      ys
    );


  let numerator =
    0;

  let denominator =
    0;


  for (
    let i = 0;
    i < count;
    i++
  ) {

    const dx =
      xs[i] -
      meanX;


    numerator +=
      dx *
      (
        ys[i] -
        meanY
      );


    denominator +=
      dx *
      dx;
  }


  if (
    denominator === 0
  ) {

    return {

      slope: 0,

      intercept:
        meanY,

      r2: 0

    };
  }


  const slope =
    numerator /
    denominator;


  const intercept =
    meanY -
    slope *
    meanX;


  let totalVariance =
    0;

  let residualVariance =
    0;


  for (
    let i = 0;
    i < count;
    i++
  ) {

    const actual =
      ys[i];


    const predicted =
      intercept +
      slope *
      xs[i];


    const totalDifference =
      actual -
      meanY;


    const residual =
      actual -
      predicted;


    totalVariance +=
      totalDifference *
      totalDifference;


    residualVariance +=
      residual *
      residual;
  }


  let r2 =
    0;


  if (
    totalVariance >
    0
  ) {

    r2 =
      1 -
      (
        residualVariance /
        totalVariance
      );
  }


  return {

    slope,

    intercept,

    r2:
      Math.max(
        0,
        Math.min(
          1,
          r2
        )
      )
  };
}


/* =========================================================
   LUMINANCE
========================================================= */

function luminance(
  r,
  g,
  b
) {

  return (
    0.2126 *
    r
    +
    0.7152 *
    g
    +
    0.0722 *
    b
  );
}


/* =========================================================
   COLLECT PATH PIXELS
========================================================= */

async function collectRegionPixels(
  original,
  originalInfo,
  maskPng
) {

  const {
    data: mask,
    info: maskInfo
  } = await sharp(
    maskPng
  )

    .removeAlpha()

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
  ) {

    return null;
  }


  const points =
    [];


  const total =
    maskInfo.width *
    maskInfo.height;


  for (
    let i = 0;
    i < total;
    i++
  ) {

    const offset =
      i * 3;


    const mr =
      mask[offset];

    const mg =
      mask[offset + 1];

    const mb =
      mask[offset + 2];


    if (
      mr < 245
      ||
      mg < 245
      ||
      mb < 245
    ) {

      continue;
    }


    const x =
      i %
      maskInfo.width;


    const y =
      Math.floor(
        i /
        maskInfo.width
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
   ANALYZE GRADIENT FIT
========================================================= */

function analyzeGradientFit(
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

      variation
    };
  }


  const xs =
    points.map(
      point =>
        point.x
    );


  const ys =
    points.map(
      point =>
        point.y
    );


  /*
   * Fit luminance horizontally and vertically.
   */

  const horizontal =
    linearRegression(
      xs,
      luminances
    );


  const vertical =
    linearRegression(
      ys,
      luminances
    );


  let direction;

  let fit;


  if (
    horizontal.r2 >=
    vertical.r2
  ) {

    direction =
      'horizontal';

    fit =
      horizontal;

  } else {

    direction =
      'vertical';

    fit =
      vertical;
  }


  /*
   * Endpoint colors:
   *
   * Rather than taking one extreme pixel,
   * average lowest/highest 15% positions.
   */

  const sorted =
    [...points].sort(
      (
        a,
        b
      ) => {

        if (
          direction ===
          'horizontal'
        ) {

          return (
            a.x -
            b.x
          );
        }


        return (
          a.y -
          b.y
        );
      }
    );


  const sampleCount =
    Math.max(
      1,
      Math.floor(
        sorted.length *
        0.15
      )
    );


  const startPoints =
    sorted.slice(
      0,
      sampleCount
    );


  const endPoints =
    sorted.slice(
      -sampleCount
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


  const startColor =
    averageColor(
      startPoints
    );


  const endColor =
    averageColor(
      endPoints
    );


  const endpointDistance =
    colorDistance(
      startColor,
      endColor
    );


  let classification =
    'REJECT';


  if (
    fit.r2 >=
      SAFE_FIT_SCORE
    &&
    endpointDistance >=
      MIN_ENDPOINT_DISTANCE
  ) {

    classification =
      'SAFE';

  } else if (
    fit.r2 >=
      POSSIBLE_FIT_SCORE
    &&
    endpointDistance >=
      MIN_ENDPOINT_DISTANCE
  ) {

    classification =
      'POSSIBLE';
  }


  return {

    type:
      classification,

    variation,

    direction,

    fit:
      fit.r2,

    startColor,

    endColor,

    endpointDistance
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
    !svgPath
    ||
    !imagePath
  ) {

    console.log(
      'Usage: node gradient-fit-analyzer.js our-current.svg test.jpg'
    );

    process.exit(
      1
    );
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


  const pathTags =
    getPathTags(
      svg
    );


  console.log('');
  console.log(
    '========================================'
  );

  console.log(
    ' GRADIENT FIT ANALYSIS'
  );

  console.log(
    '========================================'
  );


  console.log(
    `Total SVG paths: ${pathTags.length}`
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


  /* -------------------------------------------------------
     CANDIDATES
  ------------------------------------------------------- */

  const candidates =
    pathTags

      .map(
        (
          tag,
          index
        ) => {

          const d =
            getPathData(
              tag
            );


          return {

            index,

            tag,

            fill:
              getFill(
                tag
              ),

            chars:
              d.length
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
        (
          a,
          b
        ) =>
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


  const results =
    [];


  let processed =
    0;


  for (
    const candidate of
    candidates
  ) {

    processed++;


    process.stdout.write(
      `\rAnalyzing ${processed}/${candidates.length}`
    );


    const maskSvg =
      buildMaskSvg(
        svg,
        candidate.index
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


    const points =
      await collectRegionPixels(
        original,
        originalInfo,
        maskPng
      );


    if (
      !points
    ) {

      continue;
    }


    const fit =
      analyzeGradientFit(
        points
      );


    results.push({

      ...candidate,

      pixels:
        points.length,

      ...fit
    });
  }


  console.log('\n');


  /* -------------------------------------------------------
     SUMMARY
  ------------------------------------------------------- */

  const safe =
    results.filter(
      r =>
        r.type ===
        'SAFE'
    );


  const possible =
    results.filter(
      r =>
        r.type ===
        'POSSIBLE'
    );


  const flat =
    results.filter(
      r =>
        r.type ===
        'FLAT'
    );


  const rejected =
    results.filter(
      r =>
        r.type ===
        'REJECT'
    );


  console.log(
    `Useful analyzed: ${results.length}`
  );


  console.log(
    `SAFE gradients:   ${safe.length}`
  );


  console.log(
    `POSSIBLE:         ${possible.length}`
  );


  console.log(
    `FLAT:             ${flat.length}`
  );


  console.log(
    `REJECTED:         ${rejected.length}`
  );


  /* -------------------------------------------------------
     SAFE RESULTS
  ------------------------------------------------------- */

  console.log('');
  console.log(
    'TOP SAFE GRADIENTS'
  );

  console.log(
    '----------------------------------------'
  );


  safe

    .sort(
      (
        a,
        b
      ) =>
        b.pixels -
        a.pixels
    )

    .slice(
      0,
      25
    )

    .forEach(
      (
        item,
        rank
      ) => {

        console.log(

          `${String(rank + 1)
            .padStart(2, ' ')}. ` +

          `path #${item.index} | ` +

          `pixels=${item.pixels} | ` +

          `fit=${item.fit.toFixed(3)} | ` +

          `dir=${item.direction} | ` +

          `colorΔ=${item.endpointDistance.toFixed(1)} | ` +

          `fill=${item.fill}`

        );
      }
    );


  console.log('');
  console.log(
    'TOP POSSIBLE GRADIENTS'
  );

  console.log(
    '----------------------------------------'
  );


  possible

    .sort(
      (
        a,
        b
      ) =>
        b.pixels -
        a.pixels
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

          `${String(rank + 1)
            .padStart(2, ' ')}. ` +

          `path #${item.index} | ` +

          `pixels=${item.pixels} | ` +

          `fit=${item.fit.toFixed(3)} | ` +

          `dir=${item.direction} | ` +

          `colorΔ=${item.endpointDistance.toFixed(1)}`

        );
      }
    );


  console.log('');
  console.log(
    '========================================'
  );

  console.log(
    ' Gradient fit analysis complete'
  );

  console.log(
    '========================================'
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