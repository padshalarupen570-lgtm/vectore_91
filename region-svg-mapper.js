const fs = require('fs');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');


/* =========================================================
   CONFIG
========================================================= */

const ANALYSIS_WIDTH = 500;

const MIN_PATH_PIXELS = 50;
const TOP_RESULTS = 30;


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
   FORCE WHITE PATH
========================================================= */

function forceWhiteFill(tag) {
  let result = tag;


  /*
   * Replace style fill.
   */
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
          .filter(Boolean)
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


  /*
   * Replace normal fill.
   */
  if (
    /\bfill\s*=\s*["'][^"']*["']/i.test(
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


  /*
   * Stroke should not count.
   */
  if (
    /\bstroke\s*=\s*["'][^"']*["']/i.test(
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
  let index = -1;


  return svg.replace(
    /<path\b[^>]*>/gi,
    tag => {
      index++;


      if (
        index ===
        targetIndex
      ) {
        return forceWhiteFill(
          tag
        );
      }


      /*
       * Critical:
       * all other paths completely removed.
       */
      return '';
    }
  );
}


/* =========================================================
   RENDER PATH
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
   MAIN
========================================================= */

async function main() {
  const svgPath =
    process.argv[2];

  const regionMaskPath =
    process.argv[3];

  const regionName =
    process.argv[4] ||
    'R6';

  const jsonOutput =
    process.argv[5] ||
    'region-svg-map.json';


  if (
    !svgPath ||
    !regionMaskPath
  ) {
    console.log(
      'Usage: node region-svg-mapper.js ' +
      'our-current.svg ' +
      'region-6-mask-500.png ' +
      'R6 ' +
      'region-6-svg-map.json'
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
      regionMaskPath
    )
  ) {
    throw new Error(
      `Region mask nahi mili: ${regionMaskPath}`
    );
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
    ' REGION -> SVG PATH MAPPER V3'
  );

  console.log(
    '===================================================='
  );


  console.log(
    `Region: ${regionName}`
  );

  console.log(
    `SVG paths: ${paths.length}`
  );


  /* =======================================================
     READ READY-MADE BINARY MASK
  ======================================================= */

  const {
    data: regionMask,
    info: regionInfo
  } =
    await sharp(
      regionMaskPath
    )
      .greyscale()
      .raw()
      .toBuffer({
        resolveWithObject:
          true
      });


  console.log(
    `Region mask: ` +
    `${regionInfo.width}x${regionInfo.height}`
  );


  if (
    regionInfo.width !==
      ANALYSIS_WIDTH
  ) {
    throw new Error(
      `Region mask width ${regionInfo.width} hai; expected ${ANALYSIS_WIDTH}`
    );
  }


  let regionPixels = 0;


  for (
    let i = 0;
    i < regionMask.length;
    i++
  ) {
    if (
      regionMask[i] >=
      128
    ) {
      regionPixels++;
    }
  }


  console.log(
    `Region pixels: ${regionPixels}`
  );


  if (
    regionPixels === 0
  ) {
    throw new Error(
      'Binary region mask empty hai'
    );
  }


  /* =======================================================
     ANALYZE SVG PATHS
  ======================================================= */

  console.log('');
  console.log(
    'Mapping SVG paths...'
  );


  const results = [];


  for (
    let pathIndex = 0;
    pathIndex < paths.length;
    pathIndex++
  ) {
    process.stdout.write(
      `\rMapping path ${pathIndex + 1}/${paths.length}`
    );


    const path =
      paths[pathIndex];


    const fill =
      getFill(
        path
      );


    if (
      !fill ||
      fill.toLowerCase() ===
        'none'
    ) {
      continue;
    }


    const isolatedSvg =
      buildPathMaskSvg(
        svg,
        pathIndex
      );


    let png;


    try {
      png =
        renderSvg(
          isolatedSvg
        );
    } catch {
      continue;
    }


    const {
      data: pathMask,
      info: pathInfo
    } =
      await sharp(
        png
      )
        .ensureAlpha()
        .raw()
        .toBuffer({
          resolveWithObject:
            true
        });


    if (
      pathInfo.width !==
        regionInfo.width

      ||

      pathInfo.height !==
        regionInfo.height
    ) {
      continue;
    }


    let pathPixels = 0;
    let overlapPixels = 0;


    const total =
      pathInfo.width *
      pathInfo.height;


    for (
      let pixel = 0;
      pixel < total;
      pixel++
    ) {
      const offset =
        pixel *
        4;


      /*
       * Solid interior of target path.
       */
      const insidePath =
        pathMask[offset + 3] >= 245
        &&
        pathMask[offset] >= 245
        &&
        pathMask[offset + 1] >= 245
        &&
        pathMask[offset + 2] >= 245;


      if (!insidePath) {
        continue;
      }


      pathPixels++;


      if (
        regionMask[pixel] >=
        128
      ) {
        overlapPixels++;
      }
    }


    if (
      pathPixels <
      MIN_PATH_PIXELS
    ) {
      continue;
    }


    if (
      overlapPixels === 0
    ) {
      continue;
    }


    const pathInsideRegion =
      overlapPixels /
      pathPixels;


    const regionCovered =
      overlapPixels /
      regionPixels;


    /*
     * Geometric mean:
     *
     * High only if path is reasonably pure
     * AND covers useful part of region.
     */
    const score =
      Math.sqrt(
        pathInsideRegion *
        regionCovered
      );


    results.push({
      index:
        pathIndex,

      fill,

      pathPixels,

      overlapPixels,

      pathInsideRegion,

      regionCovered,

      score
    });
  }


  console.log('\n');


  results.sort(
    (
      a,
      b
    ) =>
      b.score -
      a.score
  );


  /* =======================================================
     REPORT
  ======================================================= */

  console.log(
    '===================================================='
  );

  console.log(
    ` TOP SVG MATCHES FOR ${regionName}`
  );

  console.log(
    '===================================================='
  );


  if (!results.length) {
    console.log(
      'No overlapping SVG paths found.'
    );
  }


  results
    .slice(
      0,
      TOP_RESULTS
    )
    .forEach(
      (
        item,
        rank
      ) => {
        console.log(
          `${String(rank + 1).padStart(2, ' ')}. ` +

          `path #${item.index} | ` +

          `fill=${item.fill} | ` +

          `pathPixels=${item.pathPixels} | ` +

          `overlap=${item.overlapPixels} | ` +

          `pathInRegion=${(
            item.pathInsideRegion *
            100
          ).toFixed(1)}% | ` +

          `regionCovered=${(
            item.regionCovered *
            100
          ).toFixed(1)}% | ` +

          `score=${item.score.toFixed(3)}`
        );
      }
    );


  /* =======================================================
     SAVE JSON
  ======================================================= */

  const output = {
    region:
      regionName,

    regionPixels,

    analysisWidth:
      regionInfo.width,

    analysisHeight:
      regionInfo.height,

    totalSvgPaths:
      paths.length,

    matchingPaths:
      results.length,

    matches:
      results.slice(
        0,
        TOP_RESULTS
      )
  };


  fs.writeFileSync(
    jsonOutput,
    JSON.stringify(
      output,
      null,
      2
    ),
    'utf8'
  );


  console.log('');

  console.log(
    `Matching paths: ${results.length}`
  );

  console.log(
    `Saved: ${jsonOutput}`
  );


  console.log('');
  console.log(
    '===================================================='
  );

  console.log(
    ' Region mapping complete'
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

    process.exit(1);
  }
);