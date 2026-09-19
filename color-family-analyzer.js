const fs = require('fs');


/* =========================================================
   CONFIG
========================================================= */

/*
 * Greedy centroid clustering.
 *
 * Ye values intentionally conservative hain.
 */

const MAX_CENTROID_DISTANCE = 14.0;

const MAX_L_RANGE = 24.0;

/*
 * Neutral colors:
 * gray / white / near-black
 *
 * LAB chroma < this threshold ko neutral maana jayega.
 */
const NEUTRAL_CHROMA = 8.0;

/*
 * Chromatic families ke hue mein maximum difference.
 */
const MAX_HUE_DIFFERENCE = 32.0;


/* =========================================================
   SVG FILL
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
   COLOR PARSER
========================================================= */

function parseColor(value) {

  if (!value) {
    return null;
  }


  value =
    value.trim();


  let match = value.match(
    /^#([0-9a-fA-F]{6})$/
  );


  if (match) {

    const hex =
      match[1];


    return {

      r:
        parseInt(
          hex.slice(
            0,
            2
          ),
          16
        ),

      g:
        parseInt(
          hex.slice(
            2,
            4
          ),
          16
        ),

      b:
        parseInt(
          hex.slice(
            4,
            6
          ),
          16
        )
    };
  }


  match = value.match(
    /^#([0-9a-fA-F]{3})$/
  );


  if (match) {

    const hex =
      match[1];


    return {

      r:
        parseInt(
          hex[0] +
          hex[0],
          16
        ),

      g:
        parseInt(
          hex[1] +
          hex[1],
          16
        ),

      b:
        parseInt(
          hex[2] +
          hex[2],
          16
        )
    };
  }


  match = value.match(
    /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i
  );


  if (match) {

    return {

      r:
        Number(
          match[1]
        ),

      g:
        Number(
          match[2]
        ),

      b:
        Number(
          match[3]
        )
    };
  }


  return null;
}


/* =========================================================
   RGB -> XYZ
========================================================= */

function srgbToLinear(
  value
) {

  value /=
    255;


  if (
    value <=
    0.04045
  ) {

    return (
      value /
      12.92
    );
  }


  return Math.pow(

    (
      value +
      0.055
    )
    /
    1.055,

    2.4
  );
}


function rgbToXyz(
  r,
  g,
  b
) {

  r =
    srgbToLinear(
      r
    );

  g =
    srgbToLinear(
      g
    );

  b =
    srgbToLinear(
      b
    );


  return {

    x:
      (
        r * 0.4124564 +
        g * 0.3575761 +
        b * 0.1804375
      )
      *
      100,

    y:
      (
        r * 0.2126729 +
        g * 0.7151522 +
        b * 0.0721750
      )
      *
      100,

    z:
      (
        r * 0.0193339 +
        g * 0.1191920 +
        b * 0.9503041
      )
      *
      100
  };
}


/* =========================================================
   XYZ -> LAB
========================================================= */

function xyzToLab(
  x,
  y,
  z
) {

  x /=
    95.047;

  y /=
    100.000;

  z /=
    108.883;


  function transform(
    value
  ) {

    if (
      value >
      0.008856
    ) {

      return Math.cbrt(
        value
      );
    }


    return (
      7.787 *
      value
      +
      16 /
      116
    );
  }


  const fx =
    transform(
      x
    );

  const fy =
    transform(
      y
    );

  const fz =
    transform(
      z
    );


  return {

    L:
      116 *
      fy
      -
      16,

    a:
      500 *
      (
        fx -
        fy
      ),

    b:
      200 *
      (
        fy -
        fz
      )
  };
}


function rgbToLab(
  r,
  g,
  b
) {

  const xyz =
    rgbToXyz(
      r,
      g,
      b
    );


  return xyzToLab(
    xyz.x,
    xyz.y,
    xyz.z
  );
}


/* =========================================================
   LAB HELPERS
========================================================= */

function labDistance(
  first,
  second
) {

  const dL =
    first.L -
    second.L;

  const da =
    first.a -
    second.a;

  const db =
    first.b -
    second.b;


  return Math.sqrt(
    dL * dL +
    da * da +
    db * db
  );
}


function chroma(
  lab
) {

  return Math.sqrt(
    lab.a *
    lab.a
    +
    lab.b *
    lab.b
  );
}


function hue(
  lab
) {

  let degrees =
    Math.atan2(
      lab.b,
      lab.a
    )
    *
    180 /
    Math.PI;


  if (
    degrees <
    0
  ) {

    degrees +=
      360;
  }


  return degrees;
}


function hueDifference(
  first,
  second
) {

  let difference =
    Math.abs(
      first -
      second
    );


  if (
    difference >
    180
  ) {

    difference =
      360 -
      difference;
  }


  return difference;
}


/* =========================================================
   FAMILY STATISTICS
========================================================= */

function familyCentroid(
  family
) {

  let totalWeight =
    0;

  let L =
    0;

  let a =
    0;

  let b =
    0;


  for (
    const color of
    family.colors
  ) {

    /*
     * More frequently used fill gets more weight.
     */

    const weight =
      Math.max(
        1,
        color.pathCount
      );


    totalWeight +=
      weight;


    L +=
      color.lab.L *
      weight;

    a +=
      color.lab.a *
      weight;

    b +=
      color.lab.b *
      weight;
  }


  return {

    L:
      L /
      totalWeight,

    a:
      a /
      totalWeight,

    b:
      b /
      totalWeight
  };
}


function calculateFamilyStats(
  family
) {

  const centroid =
    familyCentroid(
      family
    );


  const lightnesses =
    family.colors.map(
      color =>
        color.lab.L
    );


  const minL =
    Math.min(
      ...lightnesses
    );


  const maxL =
    Math.max(
      ...lightnesses
    );


  const totalPaths =
    family.colors.reduce(
      (
        total,
        color
      ) =>
        total +
        color.pathCount,
      0
    );


  return {

    centroid,

    minL,

    maxL,

    luminanceRange:
      maxL -
      minL,

    totalPaths
  };
}


/* =========================================================
   FAMILY COMPATIBILITY
========================================================= */

function canJoinFamily(
  family,
  color
) {

  const currentStats =
    calculateFamilyStats(
      family
    );


  const distance =
    labDistance(
      currentStats.centroid,
      color.lab
    );


  if (
    distance >
    MAX_CENTROID_DISTANCE
  ) {

    return false;
  }


  const futureMinL =
    Math.min(
      currentStats.minL,
      color.lab.L
    );


  const futureMaxL =
    Math.max(
      currentStats.maxL,
      color.lab.L
    );


  if (
    futureMaxL -
    futureMinL >
    MAX_L_RANGE
  ) {

    return false;
  }


  const familyChroma =
    chroma(
      currentStats.centroid
    );


  const colorChroma =
    chroma(
      color.lab
    );


  const familyNeutral =
    familyChroma <
    NEUTRAL_CHROMA;


  const colorNeutral =
    colorChroma <
    NEUTRAL_CHROMA;


  /*
   * Don't freely mix strongly chromatic color
   * with neutral gray family.
   */

  if (
    familyNeutral !==
    colorNeutral
  ) {

    if (
      Math.max(
        familyChroma,
        colorChroma
      )
      >
      NEUTRAL_CHROMA *
      1.7
    ) {

      return false;
    }
  }


  /*
   * Hue constraint only meaningful for chromatic colors.
   */

  if (
    !familyNeutral &&
    !colorNeutral
  ) {

    const difference =
      hueDifference(

        hue(
          currentStats.centroid
        ),

        hue(
          color.lab
        )
      );


    if (
      difference >
      MAX_HUE_DIFFERENCE
    ) {

      return false;
    }
  }


  return true;
}


/* =========================================================
   BUILD COLOR LIST
========================================================= */

function getColorsFromSvg(
  svg
) {

  const paths =
    svg.match(
      /<path\b[^>]*>/gi
    ) || [];


  const counts =
    new Map();


  for (
    const pathTag of
    paths
  ) {

    const fill =
      extractFill(
        pathTag
      );


    if (!fill) {
      continue;
    }


    const parsed =
      parseColor(
        fill
      );


    if (!parsed) {
      continue;
    }


    const hex =
      (
        '#'
        +
        parsed.r
          .toString(16)
          .padStart(
            2,
            '0'
          )
        +
        parsed.g
          .toString(16)
          .padStart(
            2,
            '0'
          )
        +
        parsed.b
          .toString(16)
          .padStart(
            2,
            '0'
          )
      ).toUpperCase();


    counts.set(

      hex,

      (
        counts.get(
          hex
        ) ||
        0
      )
      +
      1
    );
  }


  const colors =
    [...counts.entries()]
      .map(
        (
          [
            hex,
            pathCount
          ]
        ) => {

          const rgb =
            parseColor(
              hex
            );


          const lab =
            rgbToLab(
              rgb.r,
              rgb.g,
              rgb.b
            );


          return {

            hex,

            pathCount,

            rgb,

            lab,

            chroma:
              chroma(
                lab
              ),

            hue:
              hue(
                lab
              )
          };
        }
      );


  /*
   * Important:
   *
   * Process most-used colors first so families
   * are anchored around dominant image colors.
   */

  colors.sort(
    (
      first,
      second
    ) =>
      second.pathCount -
      first.pathCount
  );


  return {

    paths,

    colors
  };
}


/* =========================================================
   CLUSTER
========================================================= */

function clusterColors(
  colors
) {

  const families =
    [];


  for (
    const color of
    colors
  ) {

    let bestFamily =
      null;

    let bestDistance =
      Infinity;


    for (
      const family of
      families
    ) {

      if (
        !canJoinFamily(
          family,
          color
        )
      ) {

        continue;
      }


      const stats =
        calculateFamilyStats(
          family
        );


      const distance =
        labDistance(
          stats.centroid,
          color.lab
        );


      if (
        distance <
        bestDistance
      ) {

        bestDistance =
          distance;

        bestFamily =
          family;
      }
    }


    if (
      bestFamily
    ) {

      bestFamily.colors.push(
        color
      );

    } else {

      families.push({

        colors: [
          color
        ]
      });
    }
  }


  /*
   * Recalculate and sort by number of paths.
   */

  return families
    .map(
      family => {

        const stats =
          calculateFamilyStats(
            family
          );


        return {

          ...family,

          ...stats
        };
      }
    )

    .sort(
      (
        first,
        second
      ) =>
        second.totalPaths -
        first.totalPaths
    );
}


/* =========================================================
   REPORT
========================================================= */

function report(
  svg
) {

  const {
    paths,
    colors
  } =
    getColorsFromSvg(
      svg
    );


  const families =
    clusterColors(
      colors
    );


  console.log('');

  console.log(
    '=========================================='
  );

  console.log(
    ' COLOR FAMILY ANALYSIS V2'
  );

  console.log(
    '=========================================='
  );


  console.log(
    `Paths: ${paths.length}`
  );

  console.log(
    `Flat colors: ${colors.length}`
  );

  console.log(
    `Families: ${families.length}`
  );


  console.log(
    `Max centroid ΔE: ${MAX_CENTROID_DISTANCE}`
  );

  console.log(
    `Max L* range: ${MAX_L_RANGE}`
  );


  families.forEach(
    (
      family,
      familyIndex
    ) => {

      console.log('');
      console.log(
        '------------------------------------------'
      );

      console.log(
        `Family ${familyIndex + 1}`
      );

      console.log(
        `Colors: ${family.colors.length}`
      );

      console.log(
        `Paths: ${family.totalPaths}`
      );

      console.log(
        `L* range: ${family.luminanceRange.toFixed(2)}`
      );

      console.log(

        `Centroid: ` +

        `L=${family.centroid.L.toFixed(1)} ` +

        `a=${family.centroid.a.toFixed(1)} ` +

        `b=${family.centroid.b.toFixed(1)}`

      );


      const sorted =
        [...family.colors]
          .sort(
            (
              first,
              second
            ) =>
              second.lab.L -
              first.lab.L
          );


      for (
        const color of
        sorted
      ) {

        console.log(

          `  ${color.hex} | ` +

          `paths=${String(
            color.pathCount
          ).padStart(
            3,
            ' '
          )} | ` +

          `L=${color.lab.L.toFixed(1)} | ` +

          `C=${color.chroma.toFixed(1)} | ` +

          `H=${color.hue.toFixed(1)}°`

        );
      }
    }
  );


  /* =======================================================
     GRADIENT FAMILY CANDIDATES
  ======================================================= */

  const candidates =
    families.filter(
      family =>
        family.colors.length >=
          3
        &&
        family.totalPaths >=
          30
        &&
        family.luminanceRange >=
          5
    );


  console.log('');
  console.log(
    '=========================================='
  );

  console.log(
    ' POTENTIAL GRADIENT FAMILIES V2'
  );

  console.log(
    '=========================================='
  );


  if (
    !candidates.length
  ) {

    console.log(
      'No strong candidates.'
    );
  }


  candidates.forEach(
    (
      family,
      index
    ) => {

      const palette =
        [...family.colors]
          .sort(
            (
              first,
              second
            ) =>
              second.lab.L -
              first.lab.L
          )
          .map(
            color =>
              color.hex
          );


      console.log('');

      console.log(
        `Candidate ${index + 1}`
      );

      console.log(
        `Colors: ${family.colors.length}`
      );

      console.log(
        `Paths: ${family.totalPaths}`
      );

      console.log(
        `L* range: ${family.luminanceRange.toFixed(2)}`
      );

      console.log(
        `Palette: ${palette.join(' -> ')}`
      );
    }
  );


  console.log('');
  console.log(
    '=========================================='
  );

  console.log(
    ' V2 analysis complete'
  );

  console.log(
    '=========================================='
  );

  console.log('');
}


/* =========================================================
   CLI
========================================================= */

const svgPath =
  process.argv[2];


if (!svgPath) {

  console.log(
    'Usage: node color-family-analyzer.js our-current.svg'
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

  console.error(
    `SVG nahi mili: ${svgPath}`
  );

  process.exit(
    1
  );
}


const svg =
  fs.readFileSync(
    svgPath,
    'utf8'
  );


report(
  svg
);