const imageInput = document.getElementById('imageInput');
const preview = document.getElementById('preview');
const result = document.getElementById('result');
const statusEl = document.getElementById('status');
const downloadBtn = document.getElementById('downloadBtn');
const dropzone = document.getElementById('dropzone');

let previewUrl = null;
let svgUrl = null;

function clearPreviewUrl() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
}

function clearSvgUrl() {
  if (svgUrl) {
    URL.revokeObjectURL(svgUrl);
    svgUrl = null;
  }
}

function setDownloadState(enabled) {
  if (enabled) {
    downloadBtn.classList.remove('disabled');
    downloadBtn.setAttribute('aria-disabled', 'false');
  } else {
    downloadBtn.classList.add('disabled');
    downloadBtn.setAttribute('aria-disabled', 'true');
    downloadBtn.href = '#';
  }
}

function showPreview(file) {
  clearPreviewUrl();

  const img = document.createElement('img');
  previewUrl = URL.createObjectURL(file);
  img.src = previewUrl;
  img.alt = 'Preview';

  preview.innerHTML = '';
  preview.appendChild(img);
}

async function convertFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    statusEl.textContent = 'Sirf image file upload karo.';
    return;
  }

  showPreview(file);
  result.innerHTML = '<span class="placeholder">Converting...</span>';
  clearSvgUrl();
  setDownloadState(false);
  statusEl.textContent = 'Auto converting...';

  const formData = new FormData();
  formData.append('image', file);

  try {
    const response = await fetch('/api/vectorize', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      let errMsg = 'Conversion failed';
      try {
        const errJson = await response.json();
        errMsg = errJson.error || errMsg;
      } catch {
        errMsg = await response.text();
      }
      throw new Error(errMsg);
    }

    const svgText = await response.text();

    const cleanSvg = svgText
      .replace(/<\?xml[\s\S]*?\?>\s*/i, '')
      .replace(/<!doctype[\s\S]*?>\s*/i, '');

    result.innerHTML = cleanSvg;

    clearSvgUrl();
    svgUrl = URL.createObjectURL(
      new Blob([cleanSvg], { type: 'image/svg+xml' })
    );

    downloadBtn.href = svgUrl;
    downloadBtn.download = 'vectorized.svg';
    setDownloadState(true);
    statusEl.textContent = 'Done! SVG ready for download.';
  } catch (error) {
    console.error(error);
    result.innerHTML = '<span class="placeholder">Conversion failed</span>';
    statusEl.textContent = 'Error: ' + error.message;
    setDownloadState(false);
  }
}

dropzone.addEventListener('click', () => {
  imageInput.click();
});

imageInput.addEventListener('change', () => {
  const file = imageInput.files[0];
  if (file) {
    imageInput.value = '';
    convertFile(file);
  }
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');

  const file = e.dataTransfer.files[0];
  if (file) convertFile(file);
});