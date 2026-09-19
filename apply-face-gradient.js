const fs = require('fs');


/* =========================================================
   CONFIG
========================================================= */

const TARGET_PATH = 5;

const GRADIENT_ID =
  'autoFaceGradientR6';


/*
 * R6 fit:
 * best angle = 93.5 degrees
 *
 * SVG gradient coordinates objectBoundingBox mein
 * approximate direction generate karenge.
 */
const ANGLE_DEGREES = 93.5;


const STOPS = [
  {
    offset: 0,
    color: '#fcdfd1'
  },
  {
    offset: 0.25,
    color: '#fae3d0'
  },
  {
    offset: 0.50,
    color: '#fbe0cc'
  },
  {
    offset: 0.75,
    color: '#f8d8c1'
  },
  {
    offset: 1,
    color: '#f6d0b6'
  }
];


/* =========================================================
   ANGLE -> SVG COORDINATES
========================================================= */

function gradientCoordinates(
  degrees
) {

  const radians =
    degrees *
    Math.PI /
    180;


  const dx =
    Math.cos(
      radians
    );


  const dy =
    Math.sin(
      radians
    );


  /*
   * Center gradient around object bounding box.
   *
   * Range 0..1.
   */
  const scale =
    0.5 /
    Math.max(
      Math.abs(dx),
      Math.abs(dy),
      1e-9
    );


  const x1 =
    0.5 -
    dx *
    scale;


  const y1 =
    0.5 -
    dy *
    scale;


  const x2 =
    0.5 +
    dx *
    scale;


  const y2 =
    0.5 +
    dy *
    scale;


  return {
    x1,
    y1,
    x2,
    y2
  };
}


/* =========================================================
   CREATE GRADIENT DEF
========================================================= */

function buildGradient() {

  const coordinates =
    gradientCoordinates(
      ANGLE_DEGREES
    );


  const stops =
    STOPS
      .map(
        item =>
          (
            `<stop ` +
            `offset="${(
              item.offset *
              100
            ).toFixed(1)}%" ` +
            `stop-color="${item.color}"/>`
          )
      )
      .join('');


  return (
    `<linearGradient ` +
    `id="${GRADIENT_ID}" ` +
    `gradientUnits="objectBoundingBox" ` +
    `x1="${coordinates.x1.toFixed(6)}" ` +
    `y1="${coordinates.y1.toFixed(6)}" ` +
    `x2="${coordinates.x2.toFixed(6)}" ` +
    `y2="${coordinates.y2.toFixed(6)}" ` +
    `color-interpolation="sRGB">` +
    stops +
    `</linearGradient>`
  );
}


/* =========================================================
   REPLACE PATH FILL
========================================================= */

function replaceFill(
  tag,
  fill
) {

  /*
   * Normal fill attribute.
   */
  if (
    /\bfill\s*=\s*["'][^"']*["']/i.test(
      tag
    )
  ) {

    return tag.replace(
      /\bfill\s*=\s*["'][^"']*["']/i,
      `fill="${fill}"`
    );
  }


  /*
   * Style fill.
   */
  const styleMatch =
    tag.match(
      /\bstyle\s*=\s*["']([^"']*)["']/i
    );


  if (styleMatch) {

    const style =
      styleMatch[1];


    if (
      /(?:^|;)\s*fill\s*:/i.test(
        style
      )
    ) {

      const updated =
        style.replace(
          /((?:^|;)\s*fill\s*:\s*)[^;]+/i,
          `$1${fill}`
        );


      return tag.replace(
        styleMatch[0],
        `style="${updated}"`
      );
    }
  }


  /*
   * No existing fill.
   */
  return tag.replace(
    /\/?>$/,
    ending => {

      if (
        ending === '/>'
      ) {

        return (
          ` fill="${fill}"/>`
        );
      }


      return (
        ` fill="${fill}">`
      );
    }
  );
}


/* =========================================================
   INSERT DEFS
========================================================= */

function insertGradientDef(
  svg,
  gradient
) {

  /*
   * Existing defs available.
   */
  if (
    /<defs\b[^>]*>/i.test(
      svg
    )
  ) {

    return svg.replace(
      /<defs\b[^>]*>/i,
      match =>
        match +
        gradient
    );
  }


  /*
   * Otherwise insert new defs immediately after <svg>.
   */
  return svg.replace(
    /<svg\b[^>]*>/i,
    match =>
      match +
      `<defs>${gradient}</defs>`
  );
}


/* =========================================================
   APPLY TO TARGET PATH
========================================================= */

function applyGradient(
  svg
) {

  let pathIndex =
    -1;


  let changed =
    false;


  const result =
    svg.replace(
      /<path\b[^>]*>/gi,
      tag => {

        pathIndex++;


        if (
          pathIndex !==
          TARGET_PATH
        ) {

          return tag;
        }


        changed =
          true;


        console.log(
          `Applying gradient to path #${pathIndex}`
        );


        return replaceFill(
          tag,
          `url(#${GRADIENT_ID})`
        );
      }
    );


  if (
    !changed
  ) {

    throw new Error(
      `Path #${TARGET_PATH} nahi mila`
    );
  }


  return result;
}


/* =========================================================
   MAIN
========================================================= */

function main() {

  const inputPath =
    process.argv[2];


  const outputPath =
    process.argv[3]
    ||
    'gradient-enhanced-test.svg';


  if (
    !inputPath
  ) {

    console.log(
      'Usage: node apply-face-gradient.js ' +
      'our-current.svg gradient-enhanced-test.svg'
    );

    process.exit(
      1
    );
  }


  if (
    !fs.existsSync(
      inputPath
    )
  ) {

    throw new Error(
      `SVG nahi mili: ${inputPath}`
    );
  }


  let svg =
    fs.readFileSync(
      inputPath,
      'utf8'
    );


  const gradient =
    buildGradient();


  svg =
    insertGradientDef(
      svg,
      gradient
    );


  svg =
    applyGradient(
      svg
    );


  fs.writeFileSync(
    outputPath,
    svg,
    'utf8'
  );


  console.log('');
  console.log(
    `Output: ${outputPath}`
  );

  console.log(
    `Gradient: ${GRADIENT_ID}`
  );

  console.log(
    `Target path: #${TARGET_PATH}`
  );

  console.log(
    `Angle: ${ANGLE_DEGREES} degrees`
  );

  console.log(
    `Stops: ${STOPS.length}`
  );

  console.log('');
}


/* =========================================================
   START
========================================================= */

try {

  main();

} catch (
  error
) {

  console.error(
    error
  );

  process.exit(
    1
  );
}