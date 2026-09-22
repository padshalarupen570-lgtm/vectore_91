const express =
  require("express");

const multer =
  require("multer");

const sharp =
  require("sharp");

const fs =
  require("fs");

const path =
  require("path");

const os =
  require("os");

const {
  execFile
} =
  require("child_process");

const PDFDocument =
  require("pdfkit");

const SVGtoPDF =
  require("svg-to-pdfkit");


/* =========================================================
   APP
========================================================= */

const app =
  express();

const PORT =
  process.env.PORT ||
  3000;


/* =========================================================
   PLATFORM
========================================================= */

const IS_WINDOWS =
  process.platform ===
  "win32";


/* =========================================================
   PATHS
========================================================= */

/*
 * WINDOWS:
 *
 * C:\Users\USER\.cargo\bin\vtracer.exe
 *
 * RENDER / DOCKER / LINUX:
 *
 * /root/.cargo/bin/vtracer
 *
 * Environment variable ko highest priority milegi.
 */

const VTRACER_EXE =
  process.env.VTRACER_EXE
  ||
  (
    IS_WINDOWS

      ? path.join(
          process.env.USERPROFILE || "",
          ".cargo",
          "bin",
          "vtracer.exe"
        )

      : "/root/.cargo/bin/vtracer"
  );


/*
 * WINDOWS:
 *
 * project\.venv\Scripts\python.exe
 *
 * RENDER / DOCKER:
 *
 * /opt/venv/bin/python
 */

const PYTHON_EXE =
  process.env.PYTHON_EXE
  ||
  (
    IS_WINDOWS

      ? path.join(
          __dirname,
          ".venv",
          "Scripts",
          "python.exe"
        )

      : "/opt/venv/bin/python"
  );


const PREPROCESS_SCRIPT =
  path.join(
    __dirname,
    "preprocess.py"
  );


/* =========================================================
   PDF BODY
========================================================= */

app.use(
  "/api/export/pdf",

  express.text({

    type:
      "*/*",

    limit:
      "30mb"

  })
);


/* =========================================================
   UPLOAD
========================================================= */

const upload =
  multer({

    storage:
      multer.memoryStorage(),

    limits: {

      fileSize:
        25 *
        1024 *
        1024

    },

    fileFilter:
      (
        req,
        file,
        cb
      ) => {

        if (
          !file.mimetype
          ||
          !file.mimetype.startsWith(
            "image/"
          )
        ) {

          return cb(
            new Error(
              "Sirf image files allowed hain"
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
      "public"
    )
  )
);


/* =========================================================
   HEALTH CHECK API
========================================================= */

/*
 * Render deployment ke baad:
 *
 * https://YOUR-APP.onrender.com/api/health
 *
 * Is endpoint se check kar sakte hain:
 *
 * Node
 * Python
 * VTracer
 * preprocess.py
 */

app.get(
  "/api/health",

  (
    req,
    res
  ) => {

    const pythonExists =
      fs.existsSync(
        PYTHON_EXE
      );


    const vtracerExists =
      fs.existsSync(
        VTRACER_EXE
      );


    const preprocessorExists =
      fs.existsSync(
        PREPROCESS_SCRIPT
      );


    const healthy =
      pythonExists
      &&
      vtracerExists
      &&
      preprocessorExists;


    return res
      .status(
        healthy
          ? 200
          : 503
      )
      .json({

        ok:
          healthy,

        service:
          "vectore",

        platform:
          process.platform,

        environment:
          process.env.NODE_ENV ||
          "development",

        node:
          process.version,

        dependencies: {

          python: {
            available:
              pythonExists,

            path:
              PYTHON_EXE
          },

          vtracer: {
            available:
              vtracerExists,

            path:
              VTRACER_EXE
          },

          preprocessor: {
            available:
              preprocessorExists,

            path:
              PREPROCESS_SCRIPT
          }

        }

      });
  }
);


/* =========================================================
   TEMP FILE
========================================================= */

function tempFile(
  extension
) {

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
   CLEAN SVG
========================================================= */

function stripSvgWrapper(
  svg
) {

  return String(
    svg
  )

    .replace(
      /<\?xml[\s\S]*?\?>\s*/i,
      ""
    )

    .replace(
      /<!doctype[\s\S]*?>\s*/i,
      ""
    );
}


/* =========================================================
   COUNT SVG PATHS
========================================================= */

function countSvgPaths(
  svg
) {

  const matches =
    String(
      svg
    ).match(
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

          if (
            stdout
          ) {

            console.log(
              stdout.trim()
            );
          }


          if (
            error
          ) {

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
   NORMALIZE INPUT
========================================================= */

async function normalizeInput(
  buffer,
  output
) {

  await sharp(

    buffer,

    {
      failOn:
        "none"
    }

  )

    .rotate()

    .flatten({

      background:
        "#ffffff"

    })

    .toColourspace(
      "srgb"
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
   PREPROCESS
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

    "OpenCV Preprocessor"
  );


  if (
    !fs.existsSync(
      output
    )
  ) {

    throw new Error(
      "Processed PNG generate nahi hui"
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
   * IMPORTANT:
   *
   * Tumhari existing vectorization profile ko
   * deployment ke liye change nahi kiya gaya.
   */

  const args = [

    "-i",
    input,

    "-o",
    output,


    "--preset",
    "poster",


    "--clustering",
    "color-cluster",


    "--hierarchical",
    "stacked",


    "--mode",
    "spline",


    "--filter-speckle",
    "3",


    "--color-precision",
    "7",


    "--gradient-step",
    "18",


    "--simplify",
    "1.25",


    "--path-precision",
    "3",


    "--max-colors",
    "40",


    "--optimize",
    "2"

  ];


  await execute(

    VTRACER_EXE,

    args,

    "VTracer"
  );


  if (
    !fs.existsSync(
      output
    )
  ) {

    throw new Error(
      "SVG generate nahi hua"
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
      "original.png"
    );


  const processed =
    tempFile(
      "processed.png"
    );


  const outputSvg =
    tempFile(
      "svg"
    );


  try {

    console.log(
      "[1/3] Normalizing image..."
    );


    await normalizeInput(
      buffer,
      original
    );


    console.log(
      "[2/3] Gentle illustration preprocessing..."
    );


    await preprocessImage(
      original,
      processed
    );


    console.log(
      "[3/3] VTracer balanced tracing..."
    );


    await traceImage(
      processed,
      outputSvg
    );


    const svg =
      await fs.promises.readFile(
        outputSvg,
        "utf8"
      );


    if (
      !svg
      ||
      !svg.includes(
        "<svg"
      )
    ) {

      throw new Error(
        "Invalid SVG generated"
      );
    }


    const pathCount =
      countSvgPaths(
        svg
      );


    const svgSizeKB =
      Buffer.byteLength(
        svg,
        "utf8"
      )
      /
      1024;


    console.log(
      `SVG paths: ${pathCount}`
    );


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
   VECTORIZE API
========================================================= */

app.post(

  "/api/vectorize",

  upload.single(
    "image"
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
              "Image required"

          });
      }


      console.log("");

      console.log(
        "========================================"
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
        "========================================"
      );


      res.setHeader(
        "Content-Type",
        "image/svg+xml; charset=utf-8"
      );


      res.setHeader(
        "Cache-Control",
        "no-store"
      );


      return res.send(
        svg
      );

    }

    catch (
      error
    ) {

      console.error(
        "Vectorization error:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            "Vectorization failed",

          details:
            error.message

        });
    }
  }
);


/* =========================================================
   SVG SIZE
========================================================= */

function getSvgDimensions(
  svg
) {

  let width =
    null;

  let height =
    null;


  const widthMatch =
    svg.match(
      /<svg[^>]*\bwidth=["']\s*([\d.]+)/i
    );


  const heightMatch =
    svg.match(
      /<svg[^>]*\bheight=["']\s*([\d.]+)/i
    );


  if (
    widthMatch
  ) {

    width =
      Number(
        widthMatch[1]
      );
  }


  if (
    heightMatch
  ) {

    height =
      Number(
        heightMatch[1]
      );
  }


  const viewBoxMatch =
    svg.match(
      /viewBox=["']([^"']+)["']/i
    );


  if (
    viewBoxMatch
  ) {

    const values =
      viewBoxMatch[1]

        .trim()

        .split(
          /[\s,]+/
        )

        .map(
          Number
        );


    if (
      values.length ===
        4
      &&
      values.every(
        Number.isFinite
      )
    ) {

      width =
        width ||
        values[2];


      height =
        height ||
        values[3];
    }
  }


  if (
    !Number.isFinite(
      width
    )
    ||
    width <= 0
  ) {

    width =
      800;
  }


  if (
    !Number.isFinite(
      height
    )
    ||
    height <= 0
  ) {

    height =
      600;
  }


  return {

    width,

    height

  };
}


/* =========================================================
   VECTOR PDF EXPORT
========================================================= */

app.post(

  "/api/export/pdf",

  async (
    req,
    res
  ) => {

    try {

      const svg =
        String(
          req.body || ""
        );


      if (
        !svg
        ||
        !svg.includes(
          "<svg"
        )
      ) {

        return res
          .status(400)
          .json({

            error:
              "Valid SVG required"

          });
      }


      const {
        width,
        height
      } =
        getSvgDimensions(
          svg
        );


      const maxPageSide =
        1440;


      const scale =
        Math.min(

          1,

          maxPageSide /
          width,

          maxPageSide /
          height

        );


      const pageWidth =
        Math.max(

          1,

          width *
          scale

        );


      const pageHeight =
        Math.max(

          1,

          height *
          scale

        );


      const doc =
        new PDFDocument({

          size: [

            pageWidth,

            pageHeight

          ],

          margin:
            0,

          compress:
            true

        });


      res.setHeader(
        "Content-Type",
        "application/pdf"
      );


      res.setHeader(
        "Content-Disposition",
        'attachment; filename="vector.pdf"'
      );


      res.setHeader(
        "Cache-Control",
        "no-store"
      );


      doc.pipe(
        res
      );


      /*
       * SVG -> PDF vector.
       *
       * Raster image mein convert nahi ho raha.
       */

      SVGtoPDF(

        doc,

        svg,

        0,
        0,

        {

          width:
            pageWidth,

          height:
            pageHeight,

          preserveAspectRatio:
            "xMidYMid meet",

          assumePt:
            true

        }
      );


      doc.end();

    }

    catch (
      error
    ) {

      console.error(
        "PDF export error:",
        error
      );


      if (
        !res.headersSent
      ) {

        return res
          .status(500)
          .json({

            error:
              "PDF export failed",

            details:
              error.message

          });
      }


      res.end();
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
        "LIMIT_FILE_SIZE"
    ) {

      return res
        .status(400)
        .json({

          error:
            "Maximum image size 25 MB hai"

        });
    }


    return res
      .status(400)
      .json({

        error:
          err.message ||
          "Upload error"

      });
  }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(

  PORT,

  "0.0.0.0",

  () => {

    console.log("");

    console.log(
      "========================================"
    );

    console.log(
      " VECTORE"
    );

    console.log(
      " BALANCED ILLUSTRATION MODE"
    );

    console.log(
      "========================================"
    );


    console.log(
      `Environment: ${process.env.NODE_ENV || "development"}`
    );


    console.log(
      `Platform: ${process.platform}`
    );


    console.log(
      `Server: http://0.0.0.0:${PORT}`
    );


    console.log(
      `VTracer: ${fs.existsSync(VTRACER_EXE)}`
    );


    console.log(
      `VTracer path: ${VTRACER_EXE}`
    );


    console.log(
      `Python: ${fs.existsSync(PYTHON_EXE)}`
    );


    console.log(
      `Python path: ${PYTHON_EXE}`
    );


    console.log(
      `Preprocessor: ${fs.existsSync(PREPROCESS_SCRIPT)}`
    );


    console.log(
      "Profile: Anime / Illustration Balanced"
    );


    console.log(
      "Export: SVG + Vector PDF"
    );


    console.log(
      "========================================"
    );

    console.log("");
  }
);