// Canvas helpers that force every image onto the card's aspect ratio.
//
// Whatever the provider returns — and it varies by model variant — everything
// downstream (preview, ops thumbnail, embosser composite) receives an image at
// exactly the card ratio. That is what makes the card face render consistently
// instead of appearing to change size between runs.

import { coverCrop, cardAspect, cardTarget } from '../../shared/cardGeometry.js';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Remote provider URLs would otherwise taint the canvas and block export.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

/**
 * Centre-crop an image to the card aspect ratio.
 *
 * Returns the ORIGINAL source unchanged on failure — a tainted canvas or a
 * decode error must not lose the customer's artwork.
 */
export async function normalizeToCard(src, orientation = 'horizontal', quality = 0.94) {
  if (!src) return src;
  try {
    const img = await loadImage(src);
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (!iw || !ih) return src;

    // Already correct within a hair — skip a needless re-encode.
    const ratio = iw / ih;
    const want = cardAspect(orientation);
    if (Math.abs(ratio - want) < 0.005) return src;

    const c = coverCrop(iw, ih, orientation);
    const canvas = document.createElement('canvas');
    canvas.width = c.width;
    canvas.height = c.height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, c.width, c.height);

    // JPEG at high quality: card artwork is photographic, and a PNG of this size
    // would be several megabytes per variation.
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return src;
  }
}

/** Normalize a batch, preserving order. Failures fall back to the original. */
export function normalizeAllToCard(sources, orientation = 'horizontal') {
  return Promise.all(sources.map(s => normalizeToCard(s, orientation)));
}

/**
 * Render a manual crop chosen in the cropper UI.
 *
 * @param src         source data URL
 * @param rect        {sx, sy, sw, sh} in SOURCE pixel coordinates
 * @param orientation card orientation the crop was framed against
 */
export async function renderCrop(src, rect, orientation = 'horizontal', quality = 0.94) {
  const img = await loadImage(src);
  const want = cardAspect(orientation);
  const max = cardTarget(orientation);

  // Clamp to the image so a drag that overshot cannot read outside it.
  const sw = Math.max(1, Math.min(rect.sw, img.naturalWidth));
  const sh = Math.max(1, Math.min(rect.sh, img.naturalHeight));
  const sx = Math.max(0, Math.min(rect.sx, img.naturalWidth - sw));
  const sy = Math.max(0, Math.min(rect.sy, img.naturalHeight - sh));

  // Do not upscale past the crop's own resolution.
  const width = Math.min(Math.round(sw), max.width);
  const height = Math.round(width / want);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

/** Natural dimensions of a data URL, for the cropper's initial fit. */
export async function measure(src) {
  const img = await loadImage(src);
  return { width: img.naturalWidth, height: img.naturalHeight };
}
