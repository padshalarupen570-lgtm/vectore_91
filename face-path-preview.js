const fs = require('fs');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

const WIDTH = 736;

/*
 * R6 mapping ke important paths.
 *
 * #0 intentionally excluded because it is huge/base
 * geometry and not face-specific.
 */
const TARGETS = new Map([
  [5,  '#00ff00'], // green
  [12, '#ffff00'], // yellow
  [39, '#00ffff'], // cyan
  [78, '#ff00ff']  // magenta
]);


/* =========================================================
   FORCE COLOR
========================================================= */

function forceFill(
  tag,
  color
) {
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
          .map(v => v.trim())
          .filter(Boolean)
          .join(';');

      if (clean) {
        clean += ';';
      }

      clean +=
        `fill:${color}`;

      return `style="${clean}"`;
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
          if (ending === '/>') {
            return ` fill="${color}"/>`;
          }

          return ` fill="${color}">`;
        }
      );
  }


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
   BUILD PATH LAYER
========================================================= */

function buildLayer(
  svg
) {
  let index = -1;

  return svg.replace(
    /<path\b[^>]*>/gi,
    tag => {
      index++;

      const color =
        TARGETS.get(
          index
        );

      if (!color) {
        return '';
      }

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

  const outputPath =
    process.argv[4] ||
    'face-path-preview.png';


  if (
    !svgPath ||
    !imagePath
  ) {
    console.log(
      'Usage: node face-path-preview.js ' +
      'our-current.svg test.jpg face-path-preview.png'
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


  const layerSvg =
    buildLayer(
      svg
    );


  const overlayPng =
    new Resvg(
      layerSvg,
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


  const {
    data: original,
    info
  } =
    await sharp(
      imagePath
    )
      .rotate()
      .resize({
        width: WIDTH
      })
      .ensureAlpha()
      .raw()
      .toBuffer({
        resolveWithObject: true
      });


  const {
    data: overlay,
    info: overlayInfo
  } =
    await sharp(
      overlayPng
    )
      .ensureAlpha()
      .raw()
      .toBuffer({
        resolveWithObject: true
      });


  if (
    overlayInfo.width !== info.width ||
    overlayInfo.height !== info.height
  ) {
    throw new Error(
      'SVG/image size mismatch'
    );
  }


  const result =
    Buffer.from(
      original
    );


  const total =
    info.width *
    info.height;


  const opacity =
    0.58;


  for (
    let pixel = 0;
    pixel < total;
    pixel++
  ) {
    const offset =
      pixel * 4;


    const alpha =
      overlay[
        offset + 3
      ] /
      255;


    if (
      alpha <= 0
    ) {
      continue;
    }


    const mix =
      opacity *
      alpha;


    for (
      let channel = 0;
      channel < 3;
      channel++
    ) {
      result[
        offset + channel
      ] =
        Math.round(
          original[
            offset + channel
          ] *
          (1 - mix)
          +
          overlay[
            offset + channel
          ] *
          mix
        );
    }


    result[
      offset + 3
    ] = 255;
  }


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
    `Saved: ${outputPath}`
  );

  console.log(
    'GREEN   = path #5'
  );

  console.log(
    'YELLOW  = path #12'
  );

  console.log(
    'CYAN    = path #39'
  );

  console.log(
    'MAGENTA = path #78'
  );

  console.log('');
}


main().catch(
  error => {
    console.error(error);
    process.exit(1);
  }
);