/* =========================================================
   ELEMENTS
========================================================= */

const imageInput =
  document.getElementById(
    "imageInput"
  );


const browseButton =
  document.getElementById(
    "browseButton"
  );


const dropzone =
  document.getElementById(
    "dropzone"
  );


const uploadSection =
  document.getElementById(
    "uploadSection"
  );


const features =
  document.getElementById(
    "features"
  );


const workspace =
  document.getElementById(
    "workspace"
  );


const originalImage =
  document.getElementById(
    "originalImage"
  );


const vectorPreview =
  document.getElementById(
    "vectorPreview"
  );


const vectorizeButton =
  document.getElementById(
    "vectorizeButton"
  );


const copyButton =
  document.getElementById(
    "copyButton"
  );


const newImageButton =
  document.getElementById(
    "newImageButton"
  );


const processing =
  document.getElementById(
    "processing"
  );


const processingText =
  document.getElementById(
    "processingText"
  );


const progressBar =
  document.getElementById(
    "progressBar"
  );


const resultInfo =
  document.getElementById(
    "resultInfo"
  );


const fileName =
  document.getElementById(
    "fileName"
  );


const fileMeta =
  document.getElementById(
    "fileMeta"
  );


const saveWrapper =
  document.getElementById(
    "saveWrapper"
  );


const saveButton =
  document.getElementById(
    "saveButton"
  );


const saveMenu =
  document.getElementById(
    "saveMenu"
  );


const saveSvg =
  document.getElementById(
    "saveSvg"
  );


const savePdf =
  document.getElementById(
    "savePdf"
  );


const toast =
  document.getElementById(
    "toast"
  );


const tabs =
  document.querySelectorAll(
    ".tab"
  );


/* =========================================================
   STATE
========================================================= */

let selectedFile =
  null;


let originalURL =
  null;


let currentSVG =
  null;


let progressTimer =
  null;


let toastTimer =
  null;


/* =========================================================
   BROWSE FILE
========================================================= */

browseButton.addEventListener(
  "click",
  event => {

    event.stopPropagation();

    imageInput.click();
  }
);


dropzone.addEventListener(
  "click",
  () => {

    imageInput.click();
  }
);


imageInput.addEventListener(
  "change",
  () => {

    const file =
      imageInput.files[0];


    if (
      file
    ) {

      selectFile(
        file
      );
    }
  }
);


/* =========================================================
   DRAG ENTER / OVER
========================================================= */

[
  "dragenter",
  "dragover"
].forEach(
  eventName => {

    dropzone.addEventListener(
      eventName,
      event => {

        event.preventDefault();

        event.stopPropagation();


        dropzone.classList.add(
          "dragover"
        );
      }
    );
  }
);


/* =========================================================
   DRAG LEAVE
========================================================= */

dropzone.addEventListener(
  "dragleave",
  event => {

    event.preventDefault();

    event.stopPropagation();


    dropzone.classList.remove(
      "dragover"
    );
  }
);


/* =========================================================
   DROP
========================================================= */

dropzone.addEventListener(
  "drop",
  event => {

    event.preventDefault();

    event.stopPropagation();


    dropzone.classList.remove(
      "dragover"
    );


    const files =
      event.dataTransfer.files;


    if (
      !files ||
      !files.length
    ) {

      return;
    }


    selectFile(
      files[0]
    );
  }
);


/* =========================================================
   SELECT FILE
========================================================= */

function selectFile(
  file
) {

  if (
    !file.type ||
    !file.type.startsWith(
      "image/"
    )
  ) {

    showToast(
      "Please select an image file.",
      true
    );


    return;
  }


  if (
    file.size >
    25 *
    1024 *
    1024
  ) {

    showToast(
      "Maximum image size is 25 MB.",
      true
    );


    return;
  }


  selectedFile =
    file;


  if (
    originalURL
  ) {

    URL.revokeObjectURL(
      originalURL
    );
  }


  originalURL =
    URL.createObjectURL(
      file
    );


  originalImage.src =
    originalURL;


  fileName.textContent =
    file.name;


  fileMeta.textContent =
    `${formatBytes(file.size)} • ${getFileType(file)}`;


  resetVectorResult();


  uploadSection.classList.add(
    "hidden"
  );


  features.classList.add(
    "hidden"
  );


  workspace.classList.remove(
    "hidden"
  );


  switchView(
    "original"
  );


  workspace.scrollIntoView({

    behavior:
      "smooth",

    block:
      "center"

  });
}


/* =========================================================
   VECTORIZE BUTTON
========================================================= */

vectorizeButton.addEventListener(
  "click",
  vectorizeImage
);


/* =========================================================
   VECTORIZE
========================================================= */

async function vectorizeImage() {

  if (
    !selectedFile
  ) {

    showToast(
      "Please select an image first.",
      true
    );


    return;
  }


  vectorizeButton.disabled =
    true;


  processing.classList.remove(
    "hidden"
  );


  resultInfo.textContent =
    "Creating vector…";


  startProgress();


  const formData =
    new FormData();


  formData.append(
    "image",
    selectedFile
  );


  const started =
    performance.now();


  try {

    const response =
      await fetch(

        "/api/vectorize",

        {

          method:
            "POST",

          body:
            formData

        }
      );


    if (
      !response.ok
    ) {

      let message =
        "Vectorization failed";


      try {

        const errorData =
          await response.json();


        message =
          errorData.details ||
          errorData.error ||
          message;

      }

      catch (
        error
      ) {

      }


      throw new Error(
        message
      );
    }


    const svg =
      await response.text();


    if (
      !svg ||
      !svg.includes(
        "<svg"
      )
    ) {

      throw new Error(
        "Server returned invalid SVG."
      );
    }


    /*
     * Ye VTracer ka actual
     * vector SVG result hai.
     */

    currentSVG =
      svg;


    /*
     * Browser me vector preview.
     */

    vectorPreview.innerHTML =
      currentSVG;


    const milliseconds =
      performance.now() -
      started;


    const seconds =
      (
        milliseconds /
        1000
      ).toFixed(
        1
      );


    const paths =
      (
        currentSVG.match(
          /<path\b/gi
        )
        ||
        []
      ).length;


    const bytes =
      new Blob(
        [
          currentSVG
        ]
      ).size;


    finishProgress();


    resultInfo.textContent =
      `${paths.toLocaleString()} vector paths • ${formatBytes(bytes)} • ${seconds}s`;


    setTimeout(
      () => {

        processing.classList.add(
          "hidden"
        );


        vectorizeButton.disabled =
          false;


        vectorizeButton.classList.add(
          "hidden"
        );


        copyButton.classList.remove(
          "hidden"
        );


        saveWrapper.classList.remove(
          "hidden"
        );


        switchView(
          "vector"
        );


        showToast(
          "Vector created successfully."
        );

      },
      350
    );

  }

  catch (
    error
  ) {

    console.error(
      error
    );


    stopProgress();


    processing.classList.add(
      "hidden"
    );


    vectorizeButton.disabled =
      false;


    resultInfo.textContent =
      "Vectorization failed";


    showToast(

      error.message ||
      "Vectorization failed.",

      true

    );
  }
}


/* =========================================================
   PROGRESS
========================================================= */

function startProgress() {

  clearInterval(
    progressTimer
  );


  let value =
    7;


  progressBar.style.width =
    `${value}%`;


  processingText.textContent =
    "Analyzing image...";


  progressTimer =
    setInterval(
      () => {

        if (
          value >=
          91
        ) {

          return;
        }


        value +=
          Math.random() *
          4;


        progressBar.style.width =
          `${value}%`;


        if (
          value >
          76
        ) {

          processingText.textContent =
            "Refining vector paths...";

        }

        else if (
          value >
          56
        ) {

          processingText.textContent =
            "Building vector paths...";

        }

        else if (
          value >
          35
        ) {

          processingText.textContent =
            "Detecting image regions...";

        }

        else if (
          value >
          18
        ) {

          processingText.textContent =
            "Optimizing colors...";

        }

      },
      500
    );
}


function finishProgress() {

  clearInterval(
    progressTimer
  );


  progressBar.style.width =
    "100%";


  processingText.textContent =
    "Finishing vector...";
}


function stopProgress() {

  clearInterval(
    progressTimer
  );


  progressBar.style.width =
    "0%";
}


/* =========================================================
   TABS
========================================================= */

tabs.forEach(
  tab => {

    tab.addEventListener(
      "click",
      () => {

        const view =
          tab.dataset.view;


        if (
          view ===
            "vector"
          &&
          !currentSVG
        ) {

          showToast(
            "Vectorize the image first."
          );


          return;
        }


        switchView(
          view
        );
      }
    );
  }
);


function switchView(
  view
) {

  tabs.forEach(
    tab => {

      tab.classList.toggle(

        "active",

        tab.dataset.view ===
          view

      );
    }
  );


  if (
    view ===
      "vector"
    &&
    currentSVG
  ) {

    originalImage.classList.add(
      "hidden"
    );


    vectorPreview.classList.remove(
      "hidden"
    );

  }

  else {

    originalImage.classList.remove(
      "hidden"
    );


    vectorPreview.classList.add(
      "hidden"
    );
  }
}


/* =========================================================
   SAVE MENU OPEN
========================================================= */

saveButton.addEventListener(
  "click",
  event => {

    event.stopPropagation();


    saveMenu.classList.toggle(
      "hidden"
    );
  }
);


/* =========================================================
   DON'T CLOSE WHEN CLICKING MENU
========================================================= */

saveMenu.addEventListener(
  "click",
  event => {

    event.stopPropagation();
  }
);


/* =========================================================
   CLOSE SAVE MENU OUTSIDE
========================================================= */

document.addEventListener(
  "click",
  () => {

    saveMenu.classList.add(
      "hidden"
    );
  }
);


/* =========================================================
   SAVE AS SVG
========================================================= */

saveSvg.addEventListener(
  "click",
  () => {

    if (
      !currentSVG
    ) {

      showToast(
        "No vector available.",
        true
      );


      return;
    }


    /*
     * Original vector SVG save hoga.
     *
     * Koi raster conversion nahi.
     */

    const blob =
      new Blob(

        [
          currentSVG
        ],

        {
          type:
            "image/svg+xml;charset=utf-8"
        }

      );


    downloadBlob(

      blob,

      `${getBaseFileName()}-vector.svg`

    );


    saveMenu.classList.add(
      "hidden"
    );


    showToast(
      "Vector saved as SVG."
    );
  }
);


/* =========================================================
   SAVE AS VECTOR PDF
========================================================= */

savePdf.addEventListener(
  "click",
  async () => {

    if (
      !currentSVG
    ) {

      showToast(
        "No vector available.",
        true
      );


      return;
    }


    try {

      savePdf.disabled =
        true;


      saveSvg.disabled =
        true;


      showToast(
        "Creating vector PDF..."
      );


      /*
       * SVG text server ko bhej rahe hain.
       *
       * Server SVG -> PDF vector drawing karega.
       *
       * Is process me PNG/JPEG nahi ban raha.
       */

      const response =
        await fetch(

          "/api/export/pdf",

          {

            method:
              "POST",

            headers: {

              "Content-Type":
                "image/svg+xml; charset=utf-8"

            },

            body:
              currentSVG

          }
        );


      if (
        !response.ok
      ) {

        let message =
          "PDF export failed";


        try {

          const data =
            await response.json();


          message =
            data.details ||
            data.error ||
            message;

        }

        catch (
          error
        ) {

        }


        throw new Error(
          message
        );
      }


      const blob =
        await response.blob();


      if (
        !blob ||
        blob.size ===
          0
      ) {

        throw new Error(
          "Empty PDF received."
        );
      }


      downloadBlob(

        blob,

        `${getBaseFileName()}-vector.pdf`

      );


      saveMenu.classList.add(
        "hidden"
      );


      showToast(
        "Vector saved as PDF."
      );

    }

    catch (
      error
    ) {

      console.error(
        error
      );


      showToast(

        error.message ||
        "PDF export failed.",

        true

      );

    }

    finally {

      savePdf.disabled =
        false;


      saveSvg.disabled =
        false;
    }
  }
);


/* =========================================================
   DOWNLOAD BLOB
========================================================= */

function downloadBlob(
  blob,
  filename
) {

  const url =
    URL.createObjectURL(
      blob
    );


  const anchor =
    document.createElement(
      "a"
    );


  anchor.href =
    url;


  anchor.download =
    filename;


  anchor.style.display =
    "none";


  document.body.appendChild(
    anchor
  );


  anchor.click();


  anchor.remove();


  setTimeout(
    () => {

      URL.revokeObjectURL(
        url
      );

    },
    1500
  );
}


/* =========================================================
   COPY SVG
========================================================= */

copyButton.addEventListener(
  "click",
  async () => {

    if (
      !currentSVG
    ) {

      return;
    }


    try {

      await navigator
        .clipboard
        .writeText(
          currentSVG
        );


      showToast(
        "SVG copied to clipboard."
      );

    }

    catch (
      error
    ) {

      console.error(
        error
      );


      showToast(
        "Could not copy SVG.",
        true
      );
    }
  }
);


/* =========================================================
   NEW IMAGE
========================================================= */

newImageButton.addEventListener(
  "click",
  () => {

    selectedFile =
      null;


    imageInput.value =
      "";


    resetVectorResult();


    workspace.classList.add(
      "hidden"
    );


    uploadSection.classList.remove(
      "hidden"
    );


    features.classList.remove(
      "hidden"
    );


    window.scrollTo({

      top:
        0,

      behavior:
        "smooth"

    });
  }
);


/* =========================================================
   RESET RESULT
========================================================= */

function resetVectorResult() {

  currentSVG =
    null;


  vectorPreview.innerHTML =
    "";


  copyButton.classList.add(
    "hidden"
  );


  saveWrapper.classList.add(
    "hidden"
  );


  saveMenu.classList.add(
    "hidden"
  );


  vectorizeButton.classList.remove(
    "hidden"
  );


  vectorizeButton.disabled =
    false;


  resultInfo.textContent =
    "Ready to vectorize";


  stopProgress();
}


/* =========================================================
   BASE FILE NAME
========================================================= */

function getBaseFileName() {

  if (
    !selectedFile
  ) {

    return "vector";
  }


  const name =
    selectedFile.name.replace(
      /\.[^.]+$/,
      ""
    );


  return name ||
    "vector";
}


/* =========================================================
   FILE TYPE
========================================================= */

function getFileType(
  file
) {

  if (
    !file.type
  ) {

    return "IMAGE";
  }


  const parts =
    file.type.split(
      "/"
    );


  if (
    parts.length <
    2
  ) {

    return "IMAGE";
  }


  return parts[1]
    .toUpperCase();
}


/* =========================================================
   FORMAT BYTES
========================================================= */

function formatBytes(
  bytes
) {

  if (
    bytes ===
    0
  ) {

    return "0 B";
  }


  const units = [

    "B",

    "KB",

    "MB",

    "GB"

  ];


  const index =
    Math.min(

      Math.floor(
        Math.log(bytes) /
        Math.log(1024)
      ),

      units.length -
      1

    );


  const value =
    bytes /
    Math.pow(
      1024,
      index
    );


  return (
    value.toFixed(
      index === 0
        ? 0
        : 1
    )
    +
    " "
    +
    units[index]
  );
}


/* =========================================================
   TOAST
========================================================= */

function showToast(
  message,
  isError = false
) {

  clearTimeout(
    toastTimer
  );


  toast.textContent =
    message;


  toast.classList.toggle(
    "error",
    isError
  );


  toast.classList.add(
    "show"
  );


  toastTimer =
    setTimeout(
      () => {

        toast.classList.remove(
          "show"
        );

      },
      2800
    );
}


/* =========================================================
   CLEANUP
========================================================= */

window.addEventListener(
  "beforeunload",
  () => {

    if (
      originalURL
    ) {

      URL.revokeObjectURL(
        originalURL
      );
    }
  }
);