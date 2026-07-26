// Real measurements on an uploaded photo.
//
// Replaces the previous L1, which reported `resolution: '2048×1290'` and
// `dpi: 600` as string literals no matter what the customer uploaded, and
// claimed "Laplacian blur detection" that did not exist.
//
// Browser-only (canvas). The server does not repeat these because they describe
// print suitability, not policy — a blurry photo is a quality problem, and the
// server-side blocklists remain the security boundary.

// ISO/IEC 7810 ID-1, the physical card size.
const CARD_W_MM = 85.6;
const CARD_H_MM = 53.98;
const MM_PER_INCH = 25.4;
const TARGET_DPI = 300;   // realistic floor for card artwork
const IDEAL_DPI = 600;

function decode(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image could not be decoded'));
    img.src = dataURL;
  });
}

/**
 * Variance of the Laplacian on a grayscale downscale — the standard cheap
 * sharpness proxy. Low variance means few edges, i.e. blur.
 */
function sharpnessScore(img) {
  const N = 256;
  const scale = Math.min(1, N / Math.max(img.width, img.height));
  const w = Math.max(3, Math.round(img.width * scale));
  const h = Math.max(3, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null; // tainted canvas — treat as unmeasurable rather than guessing
  }

  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      // 4-neighbour Laplacian kernel.
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (!n) return null;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * Measure an uploaded photo.
 *
 * @returns {{
 *   available: boolean, width: number, height: number, resolution: string,
 *   dpi: number, sharpness: number|null, qualityRisk: number,
 *   issues: string[], fileOK: boolean
 * }}
 */
export async function measureUpload(uploaded, orientation = 'horizontal') {
  if (!uploaded?.dataURL) {
    return {
      available: false, fileOK: false, issues: ['No file supplied'],
      qualityRisk: 100, resolution: '—', dpi: 0, sharpness: null,
      width: 0, height: 0,
    };
  }

  let img;
  try {
    img = await decode(uploaded.dataURL);
  } catch (err) {
    return {
      available: false, fileOK: false, issues: [err.message],
      qualityRisk: 100, resolution: '—', dpi: 0, sharpness: null,
      width: 0, height: 0,
    };
  }

  const { width, height } = img;
  const issues = [];

  // Effective DPI if this image were printed at card size, using the long edge
  // against the card's long edge.
  const longPx = Math.max(width, height);
  const shortPx = Math.min(width, height);
  const dpiLong = longPx / (CARD_W_MM / MM_PER_INCH);
  const dpiShort = shortPx / (CARD_H_MM / MM_PER_INCH);
  const dpi = Math.round(Math.min(dpiLong, dpiShort));

  let resolutionRisk = 0;
  if (dpi < TARGET_DPI) {
    resolutionRisk = Math.min(100, Math.round((1 - dpi / TARGET_DPI) * 100));
    issues.push(`Effective print resolution is ${dpi} DPI; ${TARGET_DPI} DPI is the minimum for embossing.`);
  } else if (dpi < IDEAL_DPI) {
    resolutionRisk = 15;
  }

  const sharpness = sharpnessScore(img);
  let blurRisk = 0;
  if (sharpness == null) {
    issues.push('Sharpness could not be measured.');
  } else if (sharpness < 40) {
    blurRisk = 70;
    issues.push('Photo looks out of focus.');
  } else if (sharpness < 120) {
    blurRisk = 30;
    issues.push('Photo is a little soft.');
  }

  // Aspect mismatch is a crop warning, not a failure.
  const targetRatio = orientation === 'vertical' ? CARD_H_MM / CARD_W_MM : CARD_W_MM / CARD_H_MM;
  const actualRatio = width / height;
  const ratioSkew = Math.abs(actualRatio - targetRatio) / targetRatio;
  let cropRisk = 0;
  if (ratioSkew > 0.35) {
    cropRisk = 20;
    issues.push('Photo shape differs from the card; some cropping will be needed.');
  }

  const qualityRisk = Math.min(100, Math.round(Math.max(resolutionRisk, blurRisk) + cropRisk * 0.5));

  return {
    available: true,
    fileOK: dpi >= TARGET_DPI * 0.5,
    width,
    height,
    resolution: `${width}×${height}`,
    dpi,
    sharpness: sharpness == null ? null : Math.round(sharpness),
    qualityRisk,
    issues,
    bytes: uploaded.size ?? null,
  };
}
