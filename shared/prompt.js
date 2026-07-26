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

/** Text-to-image prompt. `safeFreeText` must already be redacted. */
export function buildFullPrompt(selections, safeFreeText = '') {
  const base = buildStyleText(selections);
  const parts = [base, 'luxury credit card artwork, premium design, ultra detailed, 4k']
    .filter(Boolean);
  let prompt = parts.join(', ');
  if (safeFreeText && safeFreeText.trim()) prompt = `${safeFreeText.trim()}, ${prompt}`;
  return prompt;
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
    `Maintain the subject's pose and identity but transform the entire rendering style, lighting, color and texture. ` +
    `Frame the result as luxury credit card artwork: premium, ultra-detailed, embosser-friendly composition.`;

  if (safeFreeText && safeFreeText.trim()) {
    prompt += ` Additional direction: ${safeFreeText.trim()}`;
  }
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
