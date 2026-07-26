// Pixel dimensions from an encoded image, without a canvas.
//
// The serverless function needs to know how large a generated image actually is,
// to check it against the embosser's minimum before it is ever composited. There
// is no DOM there, so the dimensions are read straight out of the file headers.
//
// Matters because composeEmbosserReadyArtwork() draws onto a 1713x1080 @ 600 DPI
// canvas with drawImageCover(), which happily upscales a smaller image — the
// output looks fine in a browser preview and prints soft.

// ISO/IEC 7810 ID-1 at 600 DPI, per BANK_REGISTRY.AU_BANK.templates.front.
export const EMBOSSER_MIN = { width: 1713, height: 1080, dpi: 600 };

function b64ToBytes(base64, limit = 64) {
  // Only the header is needed; decoding a full 1 MB image would be wasteful.
  const slice = base64.slice(0, Math.ceil((limit * 4) / 3) + 4);
  const bin = typeof Buffer !== 'undefined'
    ? Buffer.from(slice, 'base64')
    : Uint8Array.from(atob(slice), c => c.charCodeAt(0));
  return bin;
}

function readPng(bytes) {
  // 8-byte signature, then IHDR: length(4) type(4) width(4) height(4)
  if (bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47];
  if (!sig.every((b, i) => bytes[i] === b)) return null;
  const view = new DataView(bytes.buffer ?? bytes, bytes.byteOffset ?? 0);
  return { width: view.getUint32(16), height: view.getUint32(20), format: 'png' };
}

function readJpeg(base64) {
  // JPEG dimensions live in a SOFn marker at an arbitrary offset, so this needs
  // more than the first few bytes.
  const bytes = b64ToBytes(base64, 64 * 1024);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
    const isSOF = (marker >= 0xc0 && marker <= 0xcf)
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return { width, height, format: 'jpeg' };
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len <= 0) break;
    i += 2 + len;
  }
  return null;
}

function readWebp(bytes) {
  if (bytes.length < 30) return null;
  const tag = String.fromCharCode(...bytes.slice(0, 4));
  if (tag !== 'RIFF') return null;
  const fmt = String.fromCharCode(...bytes.slice(12, 16));
  if (fmt === 'VP8X') {
    const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width: w, height: h, format: 'webp' };
  }
  if (fmt === 'VP8 ') {
    const w = ((bytes[27] << 8) | bytes[26]) & 0x3fff;
    const h = ((bytes[29] << 8) | bytes[28]) & 0x3fff;
    return { width: w, height: h, format: 'webp' };
  }
  return null;
}

/**
 * Read dimensions from a base64 payload or a data URL.
 * @returns {{width:number,height:number,format:string}|null}
 */
export function imageDimensions(input) {
  if (typeof input !== 'string' || !input) return null;
  const base64 = input.startsWith('data:')
    ? (input.split(',')[1] ?? '')
    : input;
  if (!base64) return null;
  try {
    const head = b64ToBytes(base64, 64);
    return readPng(head) || readWebp(head) || readJpeg(base64);
  } catch {
    return null;
  }
}

/**
 * Assess a generated image against the embosser's requirements.
 *
 * Upscaling is reported rather than silently accepted: the compositor will
 * happily stretch a small image to card size, and nothing downstream would
 * notice until it printed.
 */
export function assessEmbosserFit(input) {
  const dims = imageDimensions(input);
  if (!dims) {
    return {
      measured: false,
      note: 'Could not read image dimensions',
      meetsEmbosserMinimum: false,
      upscaleFactor: null,
    };
  }

  // Compare on the long/short edge so orientation does not matter.
  const long = Math.max(dims.width, dims.height);
  const short = Math.min(dims.width, dims.height);
  const needLong = Math.max(EMBOSSER_MIN.width, EMBOSSER_MIN.height);
  const needShort = Math.min(EMBOSSER_MIN.width, EMBOSSER_MIN.height);

  const upscaleFactor = +Math.max(needLong / long, needShort / short).toFixed(2);
  const meets = upscaleFactor <= 1;

  // Effective DPI if this image were printed at card size.
  const effectiveDpi = Math.round(EMBOSSER_MIN.dpi / Math.max(1, upscaleFactor));

  return {
    measured: true,
    ...dims,
    resolution: `${dims.width}×${dims.height}`,
    megapixels: +((dims.width * dims.height) / 1e6).toFixed(2),
    meetsEmbosserMinimum: meets,
    upscaleFactor,
    effectiveDpi,
    note: meets
      ? `Native resolution meets the ${needLong}×${needShort} embosser minimum.`
      : `Below the embosser minimum — would be upscaled ${upscaleFactor}x to reach card size (~${effectiveDpi} DPI).`,
  };
}
