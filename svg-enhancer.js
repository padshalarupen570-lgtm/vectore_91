const { Resvg } = require('@resvg/resvg-js');
const sharp = require('sharp');


function parseHexColor(value) {
  if (!value) return null;

  value = value.trim();

  let match = value.match(
    /^#([0-9a-fA-F]{6})$/
  );

  if (match) {
    const hex = match[1];

    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }

  match = value.match(
    /^#([0-9a-fA-F]{3})$/
  );

  if (match) {
    const h = match[1];

    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16)
    };
  }

  return null;
}


function rgbToHex(r, g, b) {
  const hex = value =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');

  return `#${hex(r)}${hex(g)}${hex(b)}`;
}


function colorDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;

  return Math.sqrt(
    dr * dr +
    dg * dg +
    db * db
  );
}


function extractFill(tag) {
  let match = tag.match(
    /\bfill\s*=\s*["']([^"']+)["']/i
  );

  if (match) {
    return match[1];
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

  return null;
}


function replaceFill(tag, newFill) {
  if (
    /\bfill\s*=\s*["'][^"']+["']/i.test(tag)
  ) {
    return tag.replace(
      /\bfill\s*=\s*["'][^"']+["']/i,
      `fill="${newFill}"`
    );
  }

  const styleMatch = tag.match(
    /\bstyle\s*=\s*["']([^"']+)["']/i
  );

  if (styleMatch) {
    const oldStyle = styleMatch[1];

    if (
      /(?:^|;)\s*fill\s*:/i.test(oldStyle)
    ) {
      const newStyle = oldStyle.replace(
        /((?:^|;)\s*fill\s*:\s*)[^;]+/i,
        `$1${newFill}`
      );

      return tag.replace(
        styleMatch[0],
        `style="${newStyle}"`
      );
    }
  }

  return tag.replace(
    /\/?>$/,
    ending => {
      if (ending === '/>') {
        return ` fill="${newFill}"/>`;
      }

      return ` fill="${newFill}">`;
    }
  );
}


function getSvgDimensions(svgText) {
  const viewBoxMatch = svgText.match(
    /\bviewBox\s*=\s*["']([^"']+)["']/i
  );

  if (viewBoxMatch) {
    const values = viewBoxMatch[1]
      .trim()
      .split(/[\s,]+/)
      .map(Number);

    if (
      values.length === 4 &&
      values.every(Number.isFinite)
    ) {
      return {
        x: values[0],
        y: values[1],
        width: values[2],
        height: values[3]
      };
    }
  }

  const widthMatch = svgText.match(
    /\bwidth\s*=\s*["']([0-9.]+)/i
  );

  const heightMatch = svgText.match(
    /\bheight\s*=\s*["']([0-9.]+)/i
  );

  if (widthMatch && heightMatch) {
    return {
      x: 0,
      y: 0,
      width: Number(widthMatch[1]),
      height: Number(heightMatch[1])
    };
  }

  throw new Error(
    'SVG dimensions detect nahi hui'
  );
}


function buildMaskSvg(
  svgText,
  targetIndex,
  maskColor
) {
  let current = -1;

  return svgText.replace(
    /<path\b[^>]*>/gi,
    tag => {
      current++;

      const fill = extractFill(tag);

      if (
        !fill ||
        fill === 'none'
      ) {
        return tag;
      }

      if (current === targetIndex) {
        return replaceFill(
          tag,
          maskColor
        );
      }

      return replaceFill(
        tag,
        '#000000'
      );
    }
  );
}


async function renderSvg(
  svgText,
  width
) {
  const resvg = new Resvg(
    svgText,
    {
      fitTo: {
        mode: 'width',
        value: width
      },
      background: 'rgba(0,0,0,0)'
    }
  );

  return resvg
    .render()
    .asPng();
}


async function enhanceSvg(
  originalImageBuffer,
  svgText
) {
  const dimensions =
    getSvgDimensions(svgText);

  /*
   * Analysis resolution intentionally limited.
   *
   * Har path ko full 2K resolution par analyze
   * karna unnecessarily expensive hoga.
   */
  const analysisWidth = Math.min(
    900,
    Math.max(
      400,
      Math.round(dimensions.width)
    )
  );

  /*
   * Original raster ko exactly same analysis
   * dimensions mein convert karo.
   */
  const {
    data: original,
    info
  } = await sharp(
    originalImageBuffer
  )
    .rotate()
    .flatten({
      background: '#ffffff'
    })
    .resize({
      width: analysisWidth
    })
    .removeAlpha()
    .raw()
    .toBuffer({
      resolveWithObject: true
    });

  /*
   * VTracer paths extract karo.
   */
  const pathRegex =
    /<path\b[^>]*>/gi;

  const pathTags =
    svgText.match(pathRegex) || [];

  if (!pathTags.length) {
    console.log(
      'SVG enhancer: no paths found'
    );

    return svgText;
  }

  console.log(
    `SVG enhancer: ${pathTags.length} paths detected`
  );

  let enhanced = svgText;

  /*
   * Safety:
   *
   * Bahut zyada paths ho sakte hain.
   * First stable implementation mein sirf
   * largest/useful candidates indirectly analyze
   * karne ke liye max count rakhenge.
   */
  const maxPathsToAnalyze = Math.min(
    pathTags.length,
    120
  );

  let changed = 0;

  for (
    let index = 0;
    index < maxPathsToAnalyze;
    index++
  ) {
    const originalTag =
      pathTags[index];

    const originalFill =
      extractFill(originalTag);

    const parsedFill =
      parseHexColor(originalFill);

    if (!parsedFill) {
      continue;
    }

    /*
     * Target path = white
     * Others = black
     *
     * Is rendered mask se white pixels target
     * region represent karenge.
     */
    const maskSvg =
      buildMaskSvg(
        svgText,
        index,
        '#ffffff'
      );

    let maskPng;

    try {
      maskPng =
        await renderSvg(
          maskSvg,
          analysisWidth
        );
    } catch {
      continue;
    }

    const {
      data: mask,
      info: maskInfo
    } = await sharp(
      maskPng
    )
      .removeAlpha()
      .raw()
      .toBuffer({
        resolveWithObject: true
      });

    if (
      maskInfo.width !== info.width ||
      maskInfo.height !== info.height
    ) {
      continue;
    }

    const sampled = [];

    let pixelCount = 0;

    const totalPixels =
      info.width *
      info.height;

    for (
      let pixel = 0;
      pixel < totalPixels;
      pixel++
    ) {
      const offset =
        pixel * 3;

      const mr =
        mask[offset];

      const mg =
        mask[offset + 1];

      const mb =
        mask[offset + 2];

      /*
       * Anti-aliased boundary ko avoid karke
       * mostly interior pixels sample karo.
       */
      if (
        mr < 245 ||
        mg < 245 ||
        mb < 245
      ) {
        continue;
      }

      pixelCount++;

      const r =
        original[offset];

      const g =
        original[offset + 1];

      const b =
        original[offset + 2];

      sampled.push([
        r,
        g,
        b
      ]);
    }

    /*
     * Tiny paths:
     * eyes/hair strands etc. unchanged rakho.
     */
    if (
      pixelCount <
      totalPixels * 0.002
    ) {
      continue;
    }

    if (
      sampled.length < 50
    ) {
      continue;
    }

    /*
     * Median color mean se safer hai because
     * highlights/outliers ka effect kam hota hai.
     */

    const reds =
      sampled
        .map(p => p[0])
        .sort((a, b) => a - b);

    const greens =
      sampled
        .map(p => p[1])
        .sort((a, b) => a - b);

    const blues =
      sampled
        .map(p => p[2])
        .sort((a, b) => a - b);

    const middle =
      Math.floor(
        sampled.length / 2
      );

    const sampledColor = {
      r: reds[middle],
      g: greens[middle],
      b: blues[middle]
    };

    const difference =
      colorDistance(
        parsedFill,
        sampledColor
      );

    /*
     * Very close:
     * VTracer fill already correct.
     */
    if (difference < 5) {
      continue;
    }

    /*
     * Very large difference usually means mask/path
     * mapping suspicious hai. Don't modify it.
     */
    if (difference > 65) {
      continue;
    }

    const correctedFill =
      rgbToHex(
        sampledColor.r,
        sampledColor.g,
        sampledColor.b
      );

    const correctedTag =
      replaceFill(
        originalTag,
        correctedFill
      );

    /*
     * Replace one occurrence only.
     */
    enhanced =
      enhanced.replace(
        originalTag,
        correctedTag
      );

    changed++;
  }

  console.log(
    `SVG enhancer: ${changed} large fills color-corrected`
  );

  return enhanced;
}


module.exports = {
  enhanceSvg
};