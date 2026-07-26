// Prompt assembly, shared by the client (for preview) and the server (for the
// real provider call).
//
// The server must never concatenate raw strings from the request body into a
// provider prompt — that is a prompt-injection channel that bypasses the text
// blocklists entirely, since the blocklists only ever saw `freeText`. Style
// selections are therefore validated against a closed vocabulary and anything
// unrecognised is dropped.

export const VOCAB = {
  style:      ['watercolor', 'cyberpunk', 'anime', 'minimal', 'oil-painting', 'vintage-poster', '3d-render'],
  mood:       ['vibrant', 'calm', 'dark', 'dreamy', 'futuristic'],
  color:      ['warm', 'cool', 'monochrome', 'pastel', 'neon'],
  background: ['city-skyline', 'mountains', 'abstract', 'cosmic'],
};

export const ORIENTATIONS = ['horizontal', 'vertical'];

/** Keep only recognised selection values; drop anything else. */
export function sanitizeSelections(raw) {
  const out = { style: null, mood: null, color: null, background: null };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(out)) {
    const v = raw[key];
    if (typeof v === 'string' && VOCAB[key].includes(v)) out[key] = v;
  }
  return out;
}

export function sanitizeOrientation(raw) {
  return ORIENTATIONS.includes(raw) ? raw : 'horizontal';
}

const words = (v) => String(v).replace(/-/g, ' ');

// Print/emboss directives appended to every generation.
//
// Derived from BANK_REGISTRY.AU_BANK.templates.front: the chip cutout sits in the
// upper-left, and the card number and cardholder name occupy the lower band. The
// compositor draws artwork underneath those, so busy or high-contrast detail there
// makes the embossed characters unreadable.
//
// "No text" matters twice over: rendered lettering collides with the embossed
// name/number, and an image full of words trips the text_in_image detector.
const EMBOSSER_DIRECTIVES = [
  'ultra high resolution, maximum detail, professional print quality, 600 DPI suitable',
  'absolutely no text, no letters, no numbers, no logos, no watermarks, no signatures anywhere in the image',
  'keep the lower third and the upper-left corner visually calm, smooth and low-contrast, leaving clear space for the embossed card number, cardholder name and chip',
  'rich saturated print-safe colours, smooth gradients without banding, crisp edges, no visual noise or compression artefacts',
  'full-bleed edge-to-edge composition with no borders or frames',
].join(', ');

/** Quality/emboss suffix. Kept separate so tests can assert on it. */
export function embosserSuffix() {
  return EMBOSSER_DIRECTIVES;
}

/** Human-readable fragment describing the selections. Also what gets scanned. */
export function buildStyleText(selections) {
  const s = sanitizeSelections(selections);
  const parts = [];
  if (s.style)      parts.push(`${words(s.style)} style`);
  if (s.mood)       parts.push(`${s.mood} mood`);
  if (s.color)      parts.push(`${s.color} color palette`);
  if (s.background) parts.push(`${words(s.background)} background`);
  return parts.join(', ');
}

/**
 * Text-to-image prompt. `safeFreeText` must already be redacted.
 *
 * The customer's own words go FIRST. Image models weight early tokens more
 * heavily, and burying the actual request behind boilerplate is what makes output
 * drift away from what the customer asked for.
 */
export function buildFullPrompt(selections, safeFreeText = '') {
  const subject = safeFreeText?.trim();
  const base = buildStyleText(selections);
  const parts = [
    subject,
    base,
    'luxury premium credit card artwork',
    EMBOSSER_DIRECTIVES,
  ].filter(Boolean);
  return parts.join(', ');
}

/** Image-to-image prompt. `safeFreeText` must already be redacted. */
export function buildEditPrompt(selections, safeFreeText = '') {
  const s = sanitizeSelections(selections);
  const styleName = s.style ? words(s.style) : 'artistic';

  const fragments = [`Completely re-render this photograph in ${styleName} art style`];
  if (s.mood)       fragments.push(`with a strong ${s.mood} mood`);
  if (s.color)      fragments.push(`using a ${s.color} color palette`);
  if (s.background) fragments.push(`set against a ${words(s.background)} background`);

  let prompt =
    fragments.join(', ') +
    `. The output MUST look visually and stylistically distinct from the input — apply heavy artistic stylization, redraw the subject from scratch in pure ${styleName} style. ` +
    `Maintain the subject's pose and identity but transform the entire rendering style, lighting, color and texture.`;

  // Customer direction before the boilerplate, for the same reason as above.
  if (safeFreeText && safeFreeText.trim()) {
    prompt += ` Follow this direction closely: ${safeFreeText.trim()}.`;
  }
  prompt += ` Frame the result as luxury premium credit card artwork. ${EMBOSSER_DIRECTIVES}.`;
  return prompt;
}

/** Short label shown in the UI while the review runs. */
export function buildPreviewPrompt(selections, safeFreeText = '') {
  const base = buildStyleText(selections);
  const parts = [base, 'high resolution, card friendly composition'].filter(Boolean);
  let prompt = parts.join(', ');
  if (safeFreeText && safeFreeText.trim()) prompt += ` · user note: ${safeFreeText.trim()}`;
  return prompt;
}
