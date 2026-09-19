const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const app = express();

const PORT =
  process.env.PORT || 3000;


/* =========================================================
   PATHS
========================================================= */

const VTRACER_EXE =
  process.env.VTRACER_EXE ||
  path.join(
    process.env.USERPROFILE || '',
    '.cargo',
    'bin',
    'vtracer.exe'
  );

const PYTHON_EXE =
  path.join(
    __dirname,
    '.venv',
    'Scripts',
    'python.exe'
  );

const PREPROCESS_SCRIPT =
  path.join(
    __dirname,
    'preprocess.py'
  );


/* =========================================================
   UPLOAD
========================================================= */

const upload = multer({

  storage:
    multer.memoryStorage(),

  limits: {
    fileSize:
      25 * 1024 * 1024
  },

  fileFilter:
    (req, file, cb) => {

      if (
        !file.mimetype ||
        !file.mimetype.startsWith(
          'image/'
        )
      ) {

        return cb(
          new Error(
            'Sirf image files allow hain'
          )
        );
      }

      cb(
        null,
        true
      );
    }
});


/* =========================================================
   STATIC FRONTEND
========================================================= */

app.use(
  express.static(
    path.join(
      __dirname,
      'public'
    )
  )
);


/* =========================================================
   TEMP FILE
========================================================= */

function tempFile(extension) {

  const id =
    `${Date.now()}-${process.pid}-${Math.random()
      .toString(36)
      .slice(2)}`;

  return path.join(
    os.tmpdir(),
    `vectorizer-${id}.${extension}`
  );
}


/* =========================================================
   SVG CLEAN
========================================================= */

function stripSvgWrapper(svg) {

  return String(svg)

    .replace(
      /<\?xml[\s\S]*?\?>\s*/i,
      ''
    )

    .replace(
      /<!doctype[\s\S]*?>\s*/i,
      ''
    );
}


/* =========================================================
   COUNT SVG PATHS
========================================================= */

function countSvgPaths(svg) {

  const matches =
    String(svg).match(
      /<path\b/gi
    );

  return matches
    ? matches.length
    : 0;
}


/* =========================================================
   EXEC PROGRAM
========================================================= */

function execute(
  executable,
  args,
  name
) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      execFile(

        executable,

        args,

        {
          windowsHide:
            true,

          maxBuffer:
            30 *
            1024 *
            1024
        },

        (
          error,
          stdout,
          stderr
        ) => {

          if (stdout) {

            console.log(
              stdout.trim()
            );
          }


          if (error) {

            const message =
              (
                stderr &&
                stderr.trim()
              )
              ||
              error.message
              ||
              `${name} failed`;


            return reject(
              new Error(
                `${name}: ${message}`
              )
            );
          }


          resolve(
            stdout
          );
        }
      );
    }
  );
}


/* =========================================================
   NORMALIZE ORIGINAL
========================================================= */

async function normalizeInput(
  buffer,
  output
) {

  await sharp(
    buffer,
    {
      failOn:
        'none'
    }
  )

    .rotate()

    .flatten({
      background:
        '#ffffff'
    })

    .toColourspace(
      'srgb'
    )

    .png({
      compressionLevel:
        4
    })

    .toFile(
      output
    );
}


/* =========================================================
   PYTHON PREPROCESSING
========================================================= */

async function preprocessImage(
  input,
  output
) {

  await execute(

    PYTHON_EXE,

    [
      PREPROCESS_SCRIPT,
      input,
      output
    ],

    'OpenCV Preprocessor'
  );


  if (
    !fs.existsSync(
      output
    )
  ) {

    throw new Error(
      'Processed PNG generate nahi hui'
    );
  }
}


/* =========================================================
   VTRACER
========================================================= */

async function traceImage(
  input,
  output
) {

  /*
   * Current stable configuration.
   *
   * Important:
   * Ab path-by-path Resvg post processing nahi hai.
   */

  const args = [

    '-i',
    input,

    '-o',
    output,


    '--preset',
    'poster',


    '--clustering',
    'color-cluster',


    '--hierarchical',
    'stacked',


    '--mode',
    'spline',


    /*
     * Tiny garbage paths ko thoda filter karo.
     * 2 details preserve karta hai.
     */

    '--filter-speckle',
    '2',


    /*
     * Good color accuracy.
     */

    '--color-precision',
    '7',


    /*
     * Gradients ko extremely tiny layers
     * mein break hone se reduce karta hai.
     */

    '--gradient-step',
    '12',


    /*
     * Shape accuracy + reasonable simplification.
     */

    '--simplify',
    '1.15',


    /*
     * SVG coordinates.
     */

    '--path-precision',
    '3',


    /*
     * Preprocessor already around 40 colors
     * generate karta hai.

     * 44 enough headroom deta hai without
     * going back toward 128-color fragmentation.
     */

    '--max-colors',
    '44',


    '--optimize',
    '2'
  ];


  await execute(

    VTRACER_EXE,

    args,

    'VTracer'
  );


  if (
    !fs.existsSync(
      output
    )
  ) {

    throw new Error(
      'SVG generate nahi hua'
    );
  }
}


/* =========================================================
   COMPLETE PIPELINE
========================================================= */

async function vectorizeAuto(
  buffer
) {

  if (
    !fs.existsSync(
      VTRACER_EXE
    )
  ) {

    throw new Error(
      `VTracer nahi mila: ${VTRACER_EXE}`
    );
  }


  if (
    !fs.existsSync(
      PYTHON_EXE
    )
  ) {

    throw new Error(
      `Python nahi mila: ${PYTHON_EXE}`
    );
  }


  if (
    !fs.existsSync(
      PREPROCESS_SCRIPT
    )
  ) {

    throw new Error(
      `preprocess.py nahi mila: ${PREPROCESS_SCRIPT}`
    );
  }


  const original =
    tempFile(
      'original.png'
    );

  const processed =
    tempFile(
      'processed.png'
    );

  const outputSvg =
    tempFile(
      'svg'
    );


  try {

    /*
     * STEP 1
     */

    console.log(
      '[1/3] Normalizing image...'
    );


    await normalizeInput(
      buffer,
      original
    );


    /*
     * STEP 2
     */

    console.log(
      '[2/3] OpenCV/LAB preprocessing...'
    );


    await preprocessImage(
      original,
      processed
    );


    /*
     * STEP 3
     */

    console.log(
      '[3/3] VTracer spline tracing...'
    );


    await traceImage(
      processed,
      outputSvg
    );


    const svg =
      await fs.promises.readFile(
        outputSvg,
        'utf8'
      );


    if (
      !svg ||
      !svg.includes(
        '<svg'
      )
    ) {

      throw new Error(
        'Invalid SVG generated'
      );
    }


    const pathCount =
      countSvgPaths(
        svg
      );


    console.log(
      `SVG paths: ${pathCount}`
    );


    const svgSizeKB =
      Buffer.byteLength(
        svg,
        'utf8'
      )
      /
      1024;


    console.log(
      `SVG size: ${svgSizeKB.toFixed(1)} KB`
    );


    return stripSvgWrapper(
      svg
    );

  }

  finally {

    await Promise.allSettled([

      fs.promises.unlink(
        original
      ),

      fs.promises.unlink(
        processed
      ),

      fs.promises.unlink(
        outputSvg
      )

    ]);
  }
}


/* =========================================================
   API
========================================================= */

app.post(

  '/api/vectorize',

  upload.single(
    'image'
  ),

  async (
    req,
    res
  ) => {

    try {

      if (
        !req.file
      ) {

        return res
          .status(400)
          .json({

            error:
              'Image required'

          });
      }


      console.log('');

      console.log(
        '========================================'
      );


      console.log(
        `Processing: ${req.file.originalname}`
      );


      const started =
        Date.now();


      const svg =
        await vectorizeAuto(
          req.file.buffer
        );


      const seconds =
        (
          (
            Date.now() -
            started
          )
          /
          1000
        ).toFixed(
          2
        );


      console.log(
        `Completed in ${seconds}s`
      );


      console.log(
        '========================================'
      );


      res.setHeader(
        'Content-Type',
        'image/svg+xml; charset=utf-8'
      );


      res.setHeader(
        'Cache-Control',
        'no-store'
      );


      return res.send(
        svg
      );

    }

    catch (
      error
    ) {

      console.error(
        'Vectorization error:',
        error
      );


      return res
        .status(500)
        .json({

          error:
            'Vectorization failed',

          details:
            error.message

        });
    }
  }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    err,
    req,
    res,
    next
  ) => {

    console.error(
      err
    );


    if (
      err instanceof
        multer.MulterError
      &&
      err.code ===
        'LIMIT_FILE_SIZE'
    ) {

      return res
        .status(400)
        .json({

          error:
            'Maximum image size 25 MB hai'

        });
    }


    return res
      .status(400)
      .json({

        error:
          err.message ||
          'Upload error'

      });
  }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {

    console.log('');

    console.log(
      '========================================'
    );

    console.log(
      ' Fast Vectorization Server'
    );

    console.log(
      '========================================'
    );


    console.log(
      `Server: http://localhost:${PORT}`
    );


    console.log(
      `VTracer: ${fs.existsSync(VTRACER_EXE)}`
    );


    console.log(
      `Python: ${fs.existsSync(PYTHON_EXE)}`
    );


    console.log(
      `Preprocessor: ${fs.existsSync(PREPROCESS_SCRIPT)}`
    );


    console.log(
      'Profile: Anime / Illustration'
    );


    console.log(
      'Path-by-path Resvg: DISABLED'
    );


    console.log(
      '========================================'
    );

    console.log('');
  }
);