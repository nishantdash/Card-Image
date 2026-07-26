// Card geometry — the single source of truth for artwork dimensions.
//
// The bug this exists to kill: the UI is built on 1.586:1 (the real ID-1 card
// ratio) but generation asked for 16:9 = 1.778. With `background-size: cover` the
// sides get cropped, and because different Gemini model variants return different
// pixel sizes, the amount cropped varied between runs — artwork looked
// inconsistently "bigger" or "smaller" on the card for the same design.
//
// Two fixes hang off this file: ask the provider for the closest supported aspect
// ratio, then normalize whatever comes back to exactly the card ratio.

// ISO/IEC 7810 ID-1 — the standard Indian and global credit/debit card size.
//   horizontal 85.6 x 53.98 mm (3.375" x 2.125"), ~1.586:1, simplified 8:5
//   vertical   53.98 x 85.6 mm,                   ~1:1.586, simplified 5:8
// 53.98 is the precise standard; 54 is the common rounding.
export const CARD_MM = { width: 85.6, height: 53.98 };

/** Landscape aspect ratio, ~1.5858. */
export const CARD_ASPECT = CARD_MM.width / CARD_MM.height;

/** Print target at 600 DPI, matching BANK_REGISTRY.AU_BANK.templates.front. */
export const CARD_PX = { width: 1713, height: 1080, dpi: 600 };

/** Target pixel dimensions for an orientation. */
export function cardTarget(orientation = 'horizontal') {
  return orientation === 'vertical'
    ? { width: CARD_PX.height, height: CARD_PX.width }
    : { width: CARD_PX.width, height: CARD_PX.height };
}

/** Aspect ratio (w/h) for an orientation. */
export function cardAspect(orientation = 'horizontal') {
  return orientation === 'vertical' ? 1 / CARD_ASPECT : CARD_ASPECT;
}

// Provider aspect ratios, closest-first, with widely-supported fallbacks last.
// A model that rejects an unsupported ratio falls through to the next one, so
// asking for the ideal value first costs nothing.
//
// Distance from the card's true 1.586:1 / 1:1.586:
//   horizontal  8:5 = 1.600 (off 0.014)  3:2 = 1.500 (0.086)  16:9 = 1.778 (0.192)
//   vertical    5:8 = 0.625 (off 0.005)  2:3 = 0.667 (0.036)  9:16 = 0.563 (0.068)
//
// 8:5 / 5:8 are the simplified card ratios and are essentially exact. Whatever
// comes back is still trimmed to CARD_ASPECT by normalizeToCard — the ordering
// only decides how much gets trimmed, and 16:9 was throwing away ~11% of the
// width.
export const PROVIDER_ASPECTS = {
  horizontal: ['8:5', '3:2', '16:9'],
  vertical: ['5:8', '2:3', '9:16'],
};

export function providerAspects(orientation = 'horizontal') {
  return PROVIDER_ASPECTS[orientation === 'vertical' ? 'vertical' : 'horizontal'];
}

/**
 * Centre-crop geometry to convert a source image to the card aspect ratio.
 *
 * Crops rather than stretches: a stretched card face is immediately obvious,
 * whereas trimming a little off the long edge of a full-bleed design is not.
 *
 * @returns {{sx:number, sy:number, sw:number, sh:number, width:number, height:number}}
 */
export function coverCrop(sourceWidth, sourceHeight, orientation = 'horizontal') {
  const target = cardAspect(orientation);
  const source = sourceWidth / sourceHeight;

  let sw, sh;
  if (source > target) {
    // Source is wider than the card: trim the sides.
    sh = sourceHeight;
    sw = Math.round(sh * target);
  } else {
    // Source is taller: trim top and bottom.
    sw = sourceWidth;
    sh = Math.round(sw / target);
  }

  const sx = Math.max(0, Math.round((sourceWidth - sw) / 2));
  const sy = Math.max(0, Math.round((sourceHeight - sh) / 2));

  // Never upscale here — that would manufacture resolution the source does not
  // have and hide it from the embosser DPI check.
  const max = cardTarget(orientation);
  const width = Math.min(sw, max.width);
  const height = Math.round(width / target);

  return { sx, sy, sw, sh, width, height };
}
