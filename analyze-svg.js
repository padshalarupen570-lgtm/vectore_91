const fs = require('fs');


/* =========================================================
   HELPERS
========================================================= */

function extractFill(tag) {

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

    const style = match[1];

    const fillMatch = style.match(
      /(?:^|;)\s*fill\s*:\s*([^;]+)/i
    );


    if (fillMatch) {
      return fillMatch[1].trim();
    }
  }


  return 'unknown';
}


/* =========================================================
   PATH DATA
========================================================= */

function extractPathData(tag) {

  const match = tag.match(
    /\bd\s*=\s*["']([^"']+)["']/i
  );

  if (!match) {
    return '';
  }

  return match[1];
}


/* =========================================================
   PATH COMPLEXITY
========================================================= */

function analyzePathData(d) {

  if (!d) {

    return {
      chars: 0,
      commands: 0,
      numbers: 0
    };
  }


  const commandMatches =
    d.match(
      /[a-zA-Z]/g
    ) || [];


  const numberMatches =
    d.match(
      /[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g
    ) || [];


  return {

    chars:
      d.length,

    commands:
      commandMatches.length,

    numbers:
      numberMatches.length

  };
}


/* =========================================================
   COLOR COUNT
========================================================= */

function sortMap(
  map
) {

  return [
    ...map.entries()
  ].sort(
    (a, b) =>
      b[1] - a[1]
  );
}


/* =========================================================
   ANALYZE SVG
========================================================= */

function analyzeSvg(
  svg
) {

  const pathTags =
    svg.match(
      /<path\b[^>]*>/gi
    ) || [];


  console.log('');
  console.log(
    '=========================================='
  );

  console.log(
    ' SVG STRUCTURE ANALYSIS'
  );

  console.log(
    '=========================================='
  );


  console.log(
    `Total paths: ${pathTags.length}`
  );


  /* -------------------------------------------------------
     FILL STATISTICS
  ------------------------------------------------------- */

  const fillCounts =
    new Map();


  let noFill =
    0;


  for (
    const tag of pathTags
  ) {

    const fill =
      extractFill(
        tag
      );


    if (
      fill === 'none'
    ) {
      noFill++;
    }


    fillCounts.set(
      fill,
      (
        fillCounts.get(fill)
        ||
        0
      )
      +
      1
    );
  }


  console.log(
    `Unique fills: ${fillCounts.size}`
  );

  console.log(
    `fill="none": ${noFill}`
  );


  /* -------------------------------------------------------
     PATH COMPLEXITY
  ------------------------------------------------------- */

  let ultraTiny =
    0;

  let tiny =
    0;

  let small =
    0;

  let medium =
    0;

  let large =
    0;

  let huge =
    0;


  let totalChars =
    0;

  let totalCommands =
    0;

  let totalNumbers =
    0;


  const records = [];


  pathTags.forEach(
    (
      tag,
      index
    ) => {

      const d =
        extractPathData(
          tag
        );


      const data =
        analyzePathData(
          d
        );


      totalChars +=
        data.chars;


      totalCommands +=
        data.commands;


      totalNumbers +=
        data.numbers;


      /*
       * Character count isn't actual geometric area.
       *
       * But it is a useful cheap first measurement
       * of path complexity without rendering 1300 masks.
       */

      if (
        data.chars <
        40
      ) {

        ultraTiny++;

      } else if (
        data.chars <
        100
      ) {

        tiny++;

      } else if (
        data.chars <
        250
      ) {

        small++;

      } else if (
        data.chars <
        600
      ) {

        medium++;

      } else if (
        data.chars <
        1500
      ) {

        large++;

      } else {

        huge++;
      }


      records.push({

        index,

        fill:
          extractFill(
            tag
          ),

        chars:
          data.chars,

        commands:
          data.commands,

        numbers:
          data.numbers

      });
    }
  );


  console.log('');
  console.log(
    'PATH COMPLEXITY'
  );

  console.log(
    '------------------------------------------'
  );

  console.log(
    `< 40 chars:      ${ultraTiny}`
  );

  console.log(
    `40-99 chars:     ${tiny}`
  );

  console.log(
    `100-249 chars:   ${small}`
  );

  console.log(
    `250-599 chars:   ${medium}`
  );

  console.log(
    `600-1499 chars:  ${large}`
  );

  console.log(
    `1500+ chars:     ${huge}`
  );


  console.log('');
  console.log(
    `Total path chars: ${totalChars}`
  );

  console.log(
    `Total commands:   ${totalCommands}`
  );

  console.log(
    `Total numbers:    ${totalNumbers}`
  );


  /* -------------------------------------------------------
     MOST USED COLORS
  ------------------------------------------------------- */

  console.log('');
  console.log(
    'MOST USED FILLS'
  );

  console.log(
    '------------------------------------------'
  );


  const sortedFills =
    sortMap(
      fillCounts
    );


  sortedFills
    .slice(
      0,
      20
    )
    .forEach(
      (
        [
          fill,
          count
        ],
        index
      ) => {

        console.log(
          `${String(index + 1).padStart(2, ' ')}. ` +
          `${fill.padEnd(18, ' ')} ` +
          `${count} paths`
        );
      }
    );


  /* -------------------------------------------------------
     MOST COMPLEX PATHS
  ------------------------------------------------------- */

  console.log('');
  console.log(
    'TOP 20 MOST COMPLEX PATHS'
  );

  console.log(
    '------------------------------------------'
  );


  records
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
      20
    )
    .forEach(
      (
        record,
        rank
      ) => {

        console.log(

          `${String(rank + 1).padStart(2, ' ')}. ` +

          `path #${record.index} | ` +

          `fill=${record.fill} | ` +

          `chars=${record.chars} | ` +

          `commands=${record.commands}`

        );
      }
    );


  console.log('');
  console.log(
    '=========================================='
  );

  console.log(
    ' Analysis complete'
  );

  console.log(
    '=========================================='
  );

  console.log('');
}


/* =========================================================
   CLI
========================================================= */

const inputFile =
  process.argv[2];


if (!inputFile) {

  console.error(
    'Usage: node analyze-svg.js vectorized.svg'
  );

  process.exit(
    1
  );
}


if (
  !fs.existsSync(
    inputFile
  )
) {

  console.error(
    `SVG file nahi mili: ${inputFile}`
  );

  process.exit(
    1
  );
}


const svg =
  fs.readFileSync(
    inputFile,
    'utf8'
  );


analyzeSvg(
  svg
);