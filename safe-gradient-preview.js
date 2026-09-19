const fs = require('fs');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');


/* =========================================================
   CONFIG
========================================================= */

const WIDTH = 736;


/* =========================================================
   FORCE FILL
========================================================= */

function forceFill(
  tag,
  color
) {
  let result = tag;

  /*
   * style fill remove/replace.
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
          .map(v => v.trim())
          .filter(Boolean)
          .join(';');

      if (clean) {
        clean += ';';
      }

      clean +=
        `fill:${color}`;

      return (
        `style="${clean}"`
      );
    }
  );


  if (
    /\bfill\s*=\s*["'][^"']*["']/i.test(
      result
    )
  ) {
    result =
      result.replace(
        /\bfill\s*=\s*["'][^"']*["']/i,
        `fill="${color}"`
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
              ` fill="${color}"/>`
            );
          }

          return (
            ` fill="${color}">`
          );
        }
      );
  }


  /*
   * Existing stroke avoid.
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
   COLOR BY CLASSIFICATION
========================================================= */

function classificationColor(
  classification
) {

  if (
    classification ===
    'STRONG'
  ) {
    /*
     * Green.
     */
    return '#00ff55';
  }


  if (
    classification ===
    'GOOD'
  ) {
    /*
     * Yellow.
     */
    return '#ffff00';
  }


  /*
   * POSSIBLE = cyan.
   */
  return '#00ffff';
}


/* =========================================================
   CREATE CANDIDATE SVG
========================================================= */

function createCandidateSvg(
  svg,
  candidates
) {

  const map =
    new Map();


  for (
    const item of candidates
  ) {
    map.set(
      Number(item.index),
      item
    );
  }


  let index = -1;


  return svg.replace(
    /<path\b[^>]*>/gi,
    tag => {
      index++;


      const candidate =
        map.get(
          index
        );


      if (!candidate) {
        return '';
      }


      const color =
        classificationColor(
          candidate.classification
        );


      return forceFill(
        tag,
        color
      );
    }
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

  const jsonPath =
    process.argv[4];

  const outputPath =
    process.argv[5] ||
    'safe-gradient-candidates.png';


  if (
    !svgPath ||
    !imagePath ||
    !jsonPath
  ) {

    console.log(
      'Usage: node safe-gradient-preview.js our-current.svg test.jpg safe-gradient-results.json safe-gradient-candidates.png'
    );

    process.exit(1);
  }


  for (
    const file of [
      svgPath,
      imagePath,
      jsonPath
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


  const candidates =
    JSON.parse(
      fs.readFileSync(
        jsonPath,
        'utf8'
      )
    );


  if (
    !Array.isArray(
      candidates
    )
  ) {
    throw new Error(
      'Candidate JSON invalid hai'
    );
  }


  console.log('');
  console.log(
    '=========================================='
  );

  console.log(
    ' SAFE GRADIENT CANDIDATE PREVIEW'
  );

  console.log(
    '=========================================='
  );


  console.log(
    `Candidates: ${candidates.length}`
  );


  for (
    const candidate of candidates
  ) {

    console.log(
      `path #${candidate.index} | ` +
      `${candidate.classification} | ` +
      `score=${Number(candidate.score).toFixed(3)} | ` +
      `safe=${(Number(candidate.safeRatio) * 100).toFixed(1)}%`
    );
  }


  /* -------------------------------------------------------
     BUILD SVG LAYER
  ------------------------------------------------------- */

  const candidateSvg =
    createCandidateSvg(
      svg,
      candidates
    );


  const rendered =
    new Resvg(
      candidateSvg,
      {
        fitTo: {
          mode:
            'width',

          value:
            WIDTH
        },

        background:
          'rgba(0,0,0,0)'
      }
    )
      .render()
      .asPng();


  /* -------------------------------------------------------
     ORIGINAL IMAGE
  ------------------------------------------------------- */

  const {
    data: original,
    info
  } =
    await sharp(
      imagePath
    )
      .rotate()
      .resize({
        width:
          WIDTH
      })
      .ensureAlpha()
      .raw()
      .toBuffer({
        resolveWithObject:
          true
      });


  /* -------------------------------------------------------
     CANDIDATE OVERLAY
  ------------------------------------------------------- */

  const {
    data: overlay,
    info: overlayInfo
  } =
    await sharp(
      rendered
    )
      .ensureAlpha()
      .raw()
      .toBuffer({
        resolveWithObject:
          true
      });


  if (
    overlayInfo.width !==
      info.width
    ||
    overlayInfo.height !==
      info.height
  ) {

    throw new Error(
      'Image/SVG dimensions match nahi hui'
    );
  }


  /*
   * Direct alpha blend.
   */
  const result =
    Buffer.from(
      original
    );


  const pixels =
    info.width *
    info.height;


  const opacity =
    0.48;


  for (
    let i = 0;
    i < pixels;
    i++
  ) {

    const offset =
      i *
      4;


    const alpha =
      overlay[
        offset + 3
      ] /
      255;


    if (
      alpha <=
      0
    ) {
      continue;
    }


    const mix =
      opacity *
      alpha;


    result[
      offset
    ] =
      Math.round(
        original[offset] *
          (1 - mix)
        +
        overlay[offset] *
          mix
      );


    result[
      offset + 1
    ] =
      Math.round(
        original[offset + 1] *
          (1 - mix)
        +
        overlay[offset + 1] *
          mix
      );


    result[
      offset + 2
    ] =
      Math.round(
        original[offset + 2] *
          (1 - mix)
        +
        overlay[offset + 2] *
          mix
      );


    result[
      offset + 3
    ] =
      255;
  }


  /* -------------------------------------------------------
     SAVE
  ------------------------------------------------------- */

  await sharp(
    result,
    {
      raw: {
        width:
          info.width,

        height:
          info.height,

        channels:
          4
      }
    }
  )
    .png()
    .toFile(
      outputPath
    );


  console.log('');
  console.log(
    `Preview saved: ${outputPath}`
  );


  console.log('');
  console.log(
    'Legend:'
  );

  console.log(
    'GREEN  = STRONG'
  );

  console.log(
    'YELLOW = GOOD'
  );

  console.log(
    'CYAN   = POSSIBLE'
  );

  console.log(
    '=========================================='
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