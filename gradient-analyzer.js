const fs = require('fs');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');


/* =========================================================
   CONFIG
========================================================= */

const ANALYSIS_WIDTH = 500;

/*
 * Sirf relatively complex/large-looking paths ko
 * expensive raster analysis denge.
 */
const MIN_PATH_CHARS = 250;

/*
 * Maximum candidate paths.
 *
 * Is first test ko fast rakhenge.
 */
const MAX_CANDIDATES = 80;

/*
 * Rendered image mein path ka minimum pixel area.
 */
const MIN_REGION_PIXELS = 250;

/*
 * Color standard deviation:
 *
 * very low = flat fill
 * medium = gradient candidate
 * very high = textured/detail region
 */
const MIN_GRADIENT_VARIATION = 4;
const MAX_GRADIENT_VARIATION = 35;


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


/* =========================================================
   CREATE CANDIDATE-ONLY MASK SVG
========================================================= */

function buildMaskSvg(
  svg,
  targetIndex
) {
  let pathIndex = -1;

  /*
   * Every path becomes black except target = white.
   *
   * Since SVG layers can overlap, this isn't suitable
   * for final all-path mapping, but it is reliable enough
   * for a limited candidate analysis.
   */
  return svg.replace(
    /<path\b[^>]*>/gi,
    tag => {
      pathIndex++;

      if (
        pathIndex === targetIndex
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
   RENDER SVG
========================================================= */

function renderSvg(
  svg,
  width=ANALYSIS_WIDTH
) {
  const resvg = new Resvg(
    svg,
    {
      fitTo: {
        mode: 'width',
        value: width
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
   STATISTICS
========================================================= */

function stdDev(values) {
  if (!values.length) {
    return 0;
  }

  const mean =
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    )
    /
    values.length;

  let variance = 0;

  for (
    const value of values
  ) {
    const diff =
      value - mean;

    variance +=
      diff * diff;
  }

  variance /=
    values.length;

  return Math.sqrt(
    variance
  );
}


/* =========================================================
   ANALYZE ONE REGION
========================================================= */

async function analyzeRegion(
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
      resolveWithObject: true
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

  const reds = [];
  const greens = [];
  const blues = [];

  let pixels = 0;

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

    /*
     * White interior pixels only.
     * Anti-aliased border avoid karo.
     */
    if (
      mr < 245 ||
      mg < 245 ||
      mb < 245
    ) {
      continue;
    }

    pixels++;

    reds.push(
      original[offset]
    );

    greens.push(
      original[offset + 1]
    );

    blues.push(
      original[offset + 2]
    );
  }

  if (
    pixels <
    MIN_REGION_PIXELS
  ) {
    return null;
  }

  const rStd =
    stdDev(reds);

  const gStd =
    stdDev(greens);

  const bStd =
    stdDev(blues);

  const variation =
    (
      rStd +
      gStd +
      bStd
    )
    /
    3;

  return {
    pixels,
    variation,
    rStd,
    gStd,
    bStd
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
      'Usage: node gradient-analyzer.js our-current.svg test.jpg'
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


  const pathTags =
    getPathTags(svg);


  console.log('');
  console.log(
    '=========================================='
  );

  console.log(
    ' GRADIENT CANDIDATE ANALYSIS'
  );

  console.log(
    '=========================================='
  );


  console.log(
    `Total SVG paths: ${pathTags.length}`
  );


  /* -------------------------------------------------------
     PREPARE ORIGINAL IMAGE
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
     BUILD CANDIDATE LIST
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
              getFill(tag),
            chars:
              d.length
          };
        }
      )
      .filter(
        record =>
          record.chars >=
            MIN_PATH_CHARS
          &&
          record.fill
          &&
          record.fill !== 'none'
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
    `Candidate paths selected: ${candidates.length}`
  );

  console.log(
    `Analysis resolution: ${originalInfo.width}x${originalInfo.height}`
  );


  /* -------------------------------------------------------
     ANALYZE
  ------------------------------------------------------- */

  const results = [];

  let counter = 0;


  for (
    const candidate of candidates
  ) {
    counter++;

    process.stdout.write(
      `\rAnalyzing ${counter}/${candidates.length}`
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
          maskSvg,
          ANALYSIS_WIDTH
        );
    } catch {
      continue;
    }

    const stats =
      await analyzeRegion(
        original,
        originalInfo,
        maskPng
      );

    if (!stats) {
      continue;
    }

    let type =
      'TEXTURE/DETAIL';

    if (
      stats.variation <
      MIN_GRADIENT_VARIATION
    ) {
      type =
        'FLAT';

    } else if (
      stats.variation <=
      MAX_GRADIENT_VARIATION
    ) {
      type =
        'GRADIENT';
    }


    results.push({
      ...candidate,
      ...stats,
      type
    });
  }


  console.log('\n');


  /* -------------------------------------------------------
     SUMMARY
  ------------------------------------------------------- */

  const flat =
    results.filter(
      r =>
        r.type === 'FLAT'
    );

  const gradients =
    results.filter(
      r =>
        r.type ===
        'GRADIENT'
    );

  const detailed =
    results.filter(
      r =>
        r.type ===
        'TEXTURE/DETAIL'
    );


  console.log(
    '------------------------------------------'
  );

  console.log(
    `Analyzed useful regions: ${results.length}`
  );

  console.log(
    `Flat regions:            ${flat.length}`
  );

  console.log(
    `Gradient candidates:     ${gradients.length}`
  );

  console.log(
    `Texture/detail regions:  ${detailed.length}`
  );


  /* -------------------------------------------------------
     BEST GRADIENT CANDIDATES
  ------------------------------------------------------- */

  console.log('');
  console.log(
    'TOP GRADIENT CANDIDATES'
  );

  console.log(
    '------------------------------------------'
  );


  gradients
    .sort(
      (a, b) =>
        b.pixels -
        a.pixels
    )
    .slice(
      0,
      30
    )
    .forEach(
      (
        result,
        rank
      ) => {

        console.log(

          `${String(rank + 1)
            .padStart(2, ' ')}. ` +

          `path #${result.index} | ` +

          `fill=${result.fill} | ` +

          `pixels=${result.pixels} | ` +

          `variation=${result.variation.toFixed(2)} | ` +

          `chars=${result.chars}`

        );
      }
    );


  console.log('');
  console.log(
    '=========================================='
  );

  console.log(
    ' Gradient analysis complete'
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