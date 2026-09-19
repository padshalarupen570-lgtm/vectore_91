const fs = require('fs');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

const WIDTH = 500;

/*
 * V2 ke important results.
 */
const CANDIDATES = new Set([
  30,
  118,
  15,
  90,
  62,
  54,
  100,
  74,
  230,
  52,
  69,
  40
]);


/* =========================================================
   PATH HELPERS
========================================================= */

function forceFill(tag, color) {
  let result = tag;

  /*
   * Existing style fill remove karo.
   */
  result = result.replace(
    /\bstyle\s*=\s*["']([^"']*)["']/i,
    (full, style) => {
      let clean = style.replace(
        /(?:^|;)\s*fill\s*:\s*[^;]*/gi,
        ''
      );

      clean = clean
        .split(';')
        .map(v => v.trim())
        .filter(Boolean)
        .join(';');

      if (clean) {
        clean += ';';
      }

      clean += `fill:${color}`;

      return `style="${clean}"`;
    }
  );

  /*
   * Existing fill override.
   */
  if (
    /\bfill\s*=\s*["'][^"']*["']/i.test(result)
  ) {
    result = result.replace(
      /\bfill\s*=\s*["'][^"']*["']/i,
      `fill="${color}"`
    );
  } else {
    result = result.replace(
      /\/?>$/,
      ending =>
        ending === '/>'
          ? ` fill="${color}"/>`
          : ` fill="${color}">`
    );
  }

  return result;
}


/* =========================================================
   CREATE HIGHLIGHT SVG
========================================================= */

function createCandidateSvg(svg) {
  let index = -1;

  return svg.replace(
    /<path\b[^>]*>/gi,
    tag => {
      index++;

      if (
        CANDIDATES.has(index)
      ) {
        return forceFill(
          tag,
          '#ff0000'
        );
      }

      /*
       * Non-candidate paths remove.
       */
      return '';
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

  const outputPath =
    process.argv[4] ||
    'gradient-candidates-preview.png';


  if (
    !svgPath ||
    !imagePath
  ) {
    console.log(
      'Usage: node gradient-candidate-preview.js our-current.svg test.jpg gradient-candidates-preview.png'
    );

    process.exit(1);
  }


  if (!fs.existsSync(svgPath)) {
    throw new Error(
      `SVG nahi mili: ${svgPath}`
    );
  }

  if (!fs.existsSync(imagePath)) {
    throw new Error(
      `Image nahi mili: ${imagePath}`
    );
  }


  const svg =
    fs.readFileSync(
      svgPath,
      'utf8'
    );


  const candidateSvg =
    createCandidateSvg(svg);


  /*
   * Render selected paths only.
   */
  const rendered =
    new Resvg(
      candidateSvg,
      {
        fitTo: {
          mode: 'width',
          value: WIDTH
        },

        background:
          'rgba(0,0,0,0)'
      }
    )
      .render()
      .asPng();


  /*
   * Original image.
   */
  const original =
    await sharp(imagePath)
      .rotate()
      .resize({
        width: WIDTH
      })
      .png()
      .toBuffer();


  /*
   * Candidate layer ko transparent red banao.
   */
  const candidateLayer =
    await sharp(rendered)
      .ensureAlpha()
      .linear(
        [1, 1, 1, 0.48],
        [0, 0, 0, 0]
      )
      .png()
      .toBuffer();


  /*
   * Original + red overlay.
   */
  await sharp(original)
    .composite([
      {
        input:
          candidateLayer,

        blend:
          'over'
      }
    ])
    .png()
    .toFile(
      outputPath
    );


  console.log('');
  console.log(
    'Candidate preview created:'
  );

  console.log(
    outputPath
  );

  console.log('');

  console.log(
    'Highlighted paths:'
  );

  console.log(
    [...CANDIDATES]
      .map(index => `#${index}`)
      .join(', ')
  );
}


main().catch(
  error => {
    console.error(error);
    process.exit(1);
  }
);