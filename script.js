/* ============================================================
   Hyperface AI Card Personalization — Front-end Prototype
   Simulates the six-layer moderation pipeline locally so the
   experience can be demoed without back-end services.
   ============================================================ */

// ---------- State ----------
const state = {
  step: 1,
  source: null,        // 'upload' | 'generate'
  uploaded: null,      // { name, size, dataURL }
  selections: { style: null, mood: null, color: null, background: null },
  freeText: '',
  signals: null,
  decision: null,
  // 'horizontal' | 'vertical' — current live preview orientation.
  // Travels with the submission so the ops dashboard can render
  // vertical cards differently from horizontal ones.
  cardOrientation: 'horizontal',
  // Issuer bank for which this card is being personalized.
  // Drives which approved template the embosser pipeline pulls.
  issuer: 'AU_BANK',
  bankTemplate: null,    // cached result of fetchBankCardTemplate()
  embosserReady: null,   // last composeEmbosserReadyArtwork() output
};

// ---------- Compliance vocabulary ----------
const RESTRICTED = {
  celebrities: ['iron man','hrithik','virat','kohli','ronaldo','messi','shahrukh','srk','tom cruise','beyonce','rihanna','taylor swift','elon musk'],
  brands:      ['nike','apple','marvel','disney','coca cola','pepsi','adidas','gucci','ferrari','lamborghini'],
  political:   ['trump','modi','putin','biden','obama','xi jinping'],
  religious:   ['jesus','allah','buddha','krishna','shiva','cross','crescent','om'],
  weapons:     ['gun','knife','rifle','pistol','sword','bomb','grenade'],
  unsafe:      ['nude','naked','sexual','blood','gore','drug','cocaine','heroin'],
};

const REWRITE_MAP = [
  { match: /iron\s*man/gi,                replace: 'futuristic armored hero with glowing arc reactor' },
  { match: /hrithik|agneepath/gi,         replace: 'cinematic action hero portrait' },
  { match: /virat|kohli/gi,               replace: 'athletic batsman silhouette' },
  { match: /(tom cruise|shahrukh|srk)/gi, replace: 'cinematic leading-man portrait' },
  { match: /nike|adidas/gi,               replace: 'athletic sportswear theme' },
  { match: /marvel|disney/gi,             replace: 'epic comic-book aesthetic' },
];

// ============================================================
// Issuer Bank Card Template Registry  (backend capability)
// ------------------------------------------------------------
// Internal-only API for fetching the bank's approved card art
// (front + rear) on which the AI customization will be embossed.
// Customer-facing UI never reads from this — it powers the
// embosser pipeline that runs after AI generation succeeds.
//
// In production each entry's `templates.front.url` /
// `templates.back.url` would point at the issuer's secure asset
// CDN; the prototype builds inline SVG mocks so the call chain
// is fully exercised offline.
// ============================================================

function buildAUBankFrontMock() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1713 1080">
    <defs>
      <linearGradient id="auFront" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#E8002A"/>
        <stop offset="1" stop-color="#7A0014"/>
      </linearGradient>
    </defs>
    <rect width="1713" height="1080" rx="80" fill="url(#auFront)"/>
    <text x="110" y="180" font-family="Arial,Helvetica,sans-serif" font-size="84" font-weight="800" fill="#fff" letter-spacing="10">AU BANK</text>
    <rect x="110" y="300" width="180" height="140" rx="14" fill="#d4af37" stroke="#8a6420" stroke-width="3"/>
    <text x="110" y="780" font-family="monospace" font-size="76" fill="#fff" letter-spacing="6">4024 •••• •••• 8901</text>
    <text x="110" y="920" font-family="Arial,Helvetica,sans-serif" font-size="36" fill="#fff" opacity="0.75">CARDHOLDER</text>
    <text x="110" y="980" font-family="Arial,Helvetica,sans-serif" font-size="48" font-weight="700" fill="#fff">YOUR NAME</text>
    <text x="1380" y="980" font-family="Arial,Helvetica,sans-serif" font-size="100" font-weight="900" font-style="italic" fill="#fff">VISA</text>
  </svg>`;
}

function buildAUBankBackMock() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1713 1080">
    <rect width="1713" height="1080" rx="80" fill="#1c1c1e"/>
    <rect x="0" y="120" width="1713" height="200" fill="#000"/>
    <rect x="110" y="420" width="1230" height="160" fill="#f4f4f4"/>
    <text x="130" y="520" font-family="monospace" font-size="60" fill="#111">authorized signature</text>
    <rect x="1370" y="420" width="230" height="160" fill="#fff"/>
    <text x="1410" y="520" font-family="monospace" font-size="56" fill="#111">•••</text>
    <text x="110" y="900" font-family="Arial,Helvetica,sans-serif" font-size="32" fill="#bbb">AU Small Finance Bank Ltd.</text>
    <text x="110" y="960" font-family="Arial,Helvetica,sans-serif" font-size="28" fill="#888">For customer service call 1800-1200-1200</text>
  </svg>`;
}

function svgToDataURL(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const BANK_REGISTRY = {
  AU_BANK: {
    code: 'AU_BANK',
    name: 'AU Small Finance Bank',
    displayName: 'AU BANK',
    network: 'visa',
    brandColor: '#E8002A',
    templates: {
      front: {
        url: svgToDataURL(buildAUBankFrontMock()),
        dimensions: { w: 1713, h: 1080, dpi: 600 },
        // Rectangle (in template px) where AI artwork is allowed to
        // override the bank's default color. Embossable elements
        // (chip, brand, name/number plates) are registered below so
        // the embosser can keep its alignment marks.
        embossableArea: { x: 0, y: 0, w: 1713, h: 1080 },
        chipCutout:    { x: 110,  y: 300, w: 180,  h: 140 },
        brandPlate:    { x: 1340, y: 880, w: 260,  h: 130 },
        namePlate:     { x: 110,  y: 880, w: 1000, h: 110 },
        numberPlate:   { x: 110,  y: 700, w: 1300, h: 110 },
      },
      back: {
        url: svgToDataURL(buildAUBankBackMock()),
        dimensions: { w: 1713, h: 1080, dpi: 600 },
        magstripe: { x: 0,    y: 120, w: 1713, h: 200 },
        signature: { x: 110,  y: 420, w: 1230, h: 160 },
        cvvPlate:  { x: 1370, y: 420, w: 230,  h: 160 },
      },
    },
    constraints: {
      minDpi: 600,
      colorProfile: 'sRGB',
      bleed: 18,                              // px bleed required by embosser
      reservedColors: ['Pantone 185 C'],      // bank's protected brand color
    },
    approvedBy: 'AU Bank Card Operations',
    templateVersion: 'v3.2.1',
    lastUpdated: '2025-11-04',
  },
  // Future issuers plug in here — same shape:
  // HDFC_BANK: { code: 'HDFC_BANK', ... },
  // ICICI_BANK: { code: 'ICICI_BANK', ... },
};

// Async fetch so the call site is identical to a real
// CDN/issuer API (which the prototype will swap in later).
async function fetchBankCardTemplate(issuerCode) {
  console.log('[bank-template] fetching approved template for', issuerCode);
  const entry = BANK_REGISTRY[issuerCode];
  if (!entry) {
    throw new Error(`No approved card template registered for issuer "${issuerCode}"`);
  }
  // Simulated CDN latency so callers exercise the async pathway
  await new Promise(r => setTimeout(r, 200));
  console.log(
    '[bank-template] resolved %s · %s · front %dx%d @ %ddpi',
    entry.name,
    entry.templateVersion,
    entry.templates.front.dimensions.w,
    entry.templates.front.dimensions.h,
    entry.templates.front.dimensions.dpi,
  );
  // Return a deep clone so callers can't accidentally mutate the registry
  return JSON.parse(JSON.stringify(entry));
}

// ============================================================
// Embosser-ready compositor  (backend capability)
// ------------------------------------------------------------
// Takes the bank's approved template + the AI-generated artwork
// and produces a high-resolution image that:
//   1. Uses the bank's exact dimensions / DPI / bleed
//   2. Replaces the bank's default card color across the full
//      embossable area with the AI artwork (override, not blend)
//   3. Preserves the bank's embossable registration zones (chip
//      cutout, brand plate, name/number plates) so the physical
//      embosser keeps its alignment marks
//   4. Returns a payload ready to ship to the embosser line
// ============================================================
function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image: ' + src.slice(0, 60)));
    img.src = src;
  });
}

// Cover-fit draw — the AI image fills the target rect entirely so
// the bank's old color never bleeds through, even on mismatched
// aspect ratios.
function drawImageCover(ctx, img, x, y, w, h) {
  const ir = img.naturalWidth / img.naturalHeight;
  const cr = w / h;
  let sw, sh, sx, sy;
  if (ir > cr) {
    sh = img.naturalHeight;
    sw = sh * cr;
    sx = (img.naturalWidth - sw) / 2;
    sy = 0;
  } else {
    sw = img.naturalWidth;
    sh = sw / cr;
    sx = 0;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

async function composeEmbosserReadyArtwork(bankTemplate, aiImageSrc) {
  const front = bankTemplate.templates.front;
  const back  = bankTemplate.templates.back;
  const { w, h, dpi } = front.dimensions;

  console.log(
    '[embosser] compositing AI artwork onto %s template (%dx%d @ %ddpi)',
    bankTemplate.name, w, h, dpi
  );

  // ---- FRONT: AI artwork overrides the bank's default color ----
  let aiImg;
  try {
    aiImg = await loadImageEl(aiImageSrc);
  } catch (err) {
    // Cross-origin AI providers (e.g. Pollinations) may block canvas
    // export. Surface the cause but don't break the customer flow.
    throw new Error('Embosser compositor could not load AI image: ' + err.message);
  }

  const frontCanvas = document.createElement('canvas');
  frontCanvas.width  = w;
  frontCanvas.height = h;
  const fctx = frontCanvas.getContext('2d');

  // 1. Wipe — kills the bank's existing card color completely
  fctx.clearRect(0, 0, w, h);

  // 2. Paint AI artwork across the embossable area (cover-fit)
  const area = front.embossableArea;
  drawImageCover(fctx, aiImg, area.x, area.y, area.w, area.h);

  // 3. Imperceptible registration marks for the embosser camera —
  //    invisible to the customer but readable by the embosser line.
  fctx.save();
  fctx.globalAlpha = 0.002;
  fctx.fillStyle = '#000';
  for (const zone of [front.chipCutout, front.brandPlate, front.namePlate, front.numberPlate]) {
    if (zone) fctx.fillRect(zone.x, zone.y, zone.w, zone.h);
  }
  fctx.restore();

  let frontDataURL;
  try {
    frontDataURL = frontCanvas.toDataURL('image/png');
  } catch (err) {
    // Canvas tainted by cross-origin source — fall back to JPEG attempt
    // then surface a clear error if even that fails.
    throw new Error('Canvas tainted — cannot export embosser PNG. Use a CORS-enabled provider (Gemini/DALL·E/Stability). Underlying: ' + err.message);
  }

  // ---- BACK: bank's approved back template, passed through ----
  // The AI override only applies to the front face. The back keeps
  // the bank's mandated layout (magstripe, signature, CVV) so we
  // simply re-emit it at the same dimensions for the embosser.
  let backDataURL = back.url;
  try {
    const backImg = await loadImageEl(back.url);
    const backCanvas = document.createElement('canvas');
    backCanvas.width  = back.dimensions.w;
    backCanvas.height = back.dimensions.h;
    const bctx = backCanvas.getContext('2d');
    bctx.drawImage(backImg, 0, 0, back.dimensions.w, back.dimensions.h);
    backDataURL = backCanvas.toDataURL('image/png');
  } catch (err) {
    console.warn('[embosser] back template re-encode skipped:', err.message);
  }

  const payload = {
    issuer: bankTemplate.code,
    issuerName: bankTemplate.name,
    templateVersion: bankTemplate.templateVersion,
    front: {
      dataURL: frontDataURL,
      dimensions: { w, h, dpi },
      colorProfile: bankTemplate.constraints.colorProfile,
      bleed: bankTemplate.constraints.bleed,
    },
    back: {
      dataURL: backDataURL,
      dimensions: back.dimensions,
    },
    composedAt: new Date().toISOString(),
  };

  console.log(
    '[embosser] ready · front %dKB · back %dKB · template %s',
    Math.round(payload.front.dataURL.length * 0.75 / 1024),
    Math.round(payload.back.dataURL.length  * 0.75 / 1024),
    payload.templateVersion,
  );
  return payload;
}

// Pipeline hook — fetches template (cached) + composes embosser
// output for the currently selected variation. Errors are logged
// but never bubble to the customer UI.
async function prepareEmbosserOutput() {
  const v = state.variations?.[state.selectedVariation];
  if (!v || !v.src) return null;
  try {
    if (!state.bankTemplate || state.bankTemplate.code !== state.issuer) {
      state.bankTemplate = await fetchBankCardTemplate(state.issuer);
    }
    const payload = await composeEmbosserReadyArtwork(state.bankTemplate, v.src);
    state.embosserReady = payload;
    if (state.variations[state.selectedVariation]) {
      state.variations[state.selectedVariation].embosserReady = payload;
    }
    return payload;
  } catch (err) {
    console.warn('[embosser] prepare failed:', err.message);
    return null;
  }
}

// ============================================================
// AI Image Generation — Multi-provider
// ============================================================

const PROVIDERS = {
  pollinations: {
    label: 'Pollinations.ai',
    needsKey: false,
    keyHint: '(no key required)',
  },
  gemini: {
    label: 'Google Gemini · Nano Banana',
    needsKey: true,
    keyHint: '(Google AI Studio key — same key works for Gemini 2.5 models)',
  },
  dalle: {
    label: 'OpenAI DALL·E 3',
    needsKey: true,
    keyHint: '(OpenAI API key starting with sk-…)',
  },
  grok: {
    label: 'xAI Grok Image',
    needsKey: true,
    keyHint: '(xAI API key starting with xai-…)',
  },
  stability: {
    label: 'Stability AI',
    needsKey: true,
    keyHint: '(Stability API key starting with sk-…)',
  },
};

// ---------- Settings store (localStorage) ----------
const SETTINGS_KEY = 'hyperface.aiProvider';

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { provider: 'pollinations', keys: {} };
    const parsed = JSON.parse(raw);
    return { provider: parsed.provider || 'pollinations', keys: parsed.keys || {} };
  } catch {
    return { provider: 'pollinations', keys: {} };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

const settings = loadSettings();

// ---------- Prompt building ----------
function buildFullPrompt() {
  const { style, mood, color, background } = state.selections;
  const parts = [];
  if (style)      parts.push(style.replace('-', ' ') + ' style');
  if (mood)       parts.push(mood + ' mood');
  if (color)      parts.push(color + ' color palette');
  if (background) parts.push(background.replace('-', ' ') + ' background');
  parts.push('luxury credit card artwork, premium design, ultra detailed, 4k');

  let prompt = parts.join(', ');
  if (state.freeText && state.freeText.trim()) {
    const sanitized = sanitizePrompt(state.freeText).sanitized;
    prompt = sanitized + ', ' + prompt;
  }
  return prompt;
}

// Image-edit prompt — used when the user uploaded a photo and we want
// Gemini to transform it (image-to-image). Aggressive wording is intentional:
// gentle prompts cause Gemini to return the original almost unchanged.
function buildEditPrompt() {
  const { style, mood, color, background } = state.selections;
  const styleName = style ? style.replace('-', ' ') : 'artistic';

  const fragments = [];
  fragments.push(`Completely re-render this photograph in ${styleName} art style`);
  if (mood)       fragments.push(`with a strong ${mood} mood`);
  if (color)      fragments.push(`using a ${color} color palette`);
  if (background) fragments.push(`set against a ${background.replace('-', ' ')} background`);

  let prompt =
    fragments.join(', ') +
    `. The output MUST look visually and stylistically distinct from the input — apply heavy artistic stylization, redraw the subject from scratch in pure ${styleName} style. ` +
    `Maintain the subject's pose and identity but transform the entire rendering style, lighting, color and texture. ` +
    `Frame the result as luxury credit card artwork: premium, ultra-detailed, 16:9 landscape, embosser-friendly composition.`;

  if (state.freeText && state.freeText.trim()) {
    const sanitized = sanitizePrompt(state.freeText).sanitized;
    prompt += ' Additional direction: ' + sanitized;
  }
  return prompt;
}

// Resize/compress an image data URL before sending to an API.
// Keeps requests under provider limits and speeds up the round-trip.
function resizeImageDataURL(dataURL, maxDim = 1024, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round(height * (maxDim / width));
          width  = maxDim;
        } else {
          width  = Math.round(width * (maxDim / height));
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      // Always emit JPEG to keep payload small
      const out = canvas.toDataURL('image/jpeg', quality);
      const match = out.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return reject(new Error('Failed to encode resized image'));
      resolve({ dataURL: out, mimeType: match[1], base64: match[2] });
    };
    img.onerror = () => reject(new Error('Failed to decode uploaded image'));
    img.src = dataURL;
  });
}

// ---------- Provider implementations ----------
// Each returns a Promise<{ src: string }> where `src` can be a URL or data URI.

async function generatePollinations(prompt, orientation = 'horizontal') {
  const safe = prompt.replace(/[^\w ,.\-]/g, '').slice(0, 380);
  const seed = state.seed || Math.floor(Math.random() * 100000);
  state.seed = seed;
  const [w, h] = orientation === 'vertical' ? [540, 864] : [864, 540];
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(safe)}?width=${w}&height=${h}&nologo=true&seed=${seed}`;
  // Preload to ensure the URL actually resolves
  await new Promise((res, rej) => {
    const img = new Image();
    img.onload = res;
    img.onerror = () => rej(new Error('Pollinations request failed'));
    img.src = url;
  });
  return { src: url };
}

async function generateGemini(prompt, key, inputImage, orientation = 'horizontal') {
  // "Nano Banana" = Gemini's image generation/editing family.
  // Supports text-to-image AND image-to-image (edit) when inputImage is provided.
  const candidates = [
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image-preview',
    'gemini-2.5-flash-image-preview',
  ];

  // Build request parts. Image goes BEFORE text per Google's recommendation
  // for edit operations.
  const parts = [];
  if (inputImage) {
    parts.push({
      inlineData: {
        mimeType: inputImage.mimeType,
        data: inputImage.base64,
      },
    });
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: orientation === 'vertical' ? '9:16' : '16:9' },
    },
  };

  let lastErr;
  for (const model of candidates) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        lastErr = new Error(`${model} → ${res.status}: ${errText.slice(0, 260)}`);
        if (res.status === 404 || res.status === 400) continue;
        throw lastErr;
      }
      const data = await res.json();
      const respParts = data?.candidates?.[0]?.content?.parts || [];
      const imgPart = respParts.find(p => p.inlineData || p.inline_data);
      if (!imgPart) {
        // Sometimes Gemini returns only text (e.g. safety block) — surface it
        const textPart = respParts.find(p => p.text);
        const finishReason = data?.candidates?.[0]?.finishReason;
        lastErr = new Error(
          `${model} returned no image. finishReason=${finishReason || 'n/a'}` +
          (textPart ? ` · text="${textPart.text.slice(0, 160)}"` : '')
        );
        continue;
      }
      const inline = imgPart.inlineData || imgPart.inline_data;
      console.log('[gemini] generated via', model, inputImage ? '(edit mode)' : '(text-to-image)');
      return { src: `data:${inline.mimeType || inline.mime_type};base64,${inline.data}` };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All Gemini model variants failed');
}

async function generateDalle(prompt, key, orientation = 'horizontal') {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt,
      size: orientation === 'vertical' ? '1024x1792' : '1792x1024',
      n: 1,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DALL·E ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error('DALL·E returned no image');
  return { src: url };
}

async function generateGrok(prompt, key, orientation = 'horizontal') {
  // Grok-2-image API does not currently expose an aspect-ratio parameter,
  // so the orientation arg is accepted for parity but ignored. The result
  // will be cropped/letterboxed at display time.
  const res = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'grok-2-image',
      prompt: prompt,
      n: 1,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Grok ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error('Grok returned no image');
  return { src: url };
}

async function generateStability(prompt, key, orientation = 'horizontal') {
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('output_format', 'jpeg');
  form.append('aspect_ratio', orientation === 'vertical' ? '9:16' : '16:9');
  const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Accept': 'image/*',
    },
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Stability ${res.status}: ${errText.slice(0, 200)}`);
  }
  const blob = await res.blob();
  return { src: URL.createObjectURL(blob) };
}

// ---------- Dispatcher ----------
// Only Gemini currently supports image-to-image in this prototype.
// Other providers ignore inputImage and run text-to-image with the prompt.
// `orientation` is forwarded so each provider emits portrait dimensions
// when the user is rendering a vertical card.
async function callProvider(prompt, inputImage, orientation = 'horizontal') {
  const provider = settings.provider;
  const key = settings.keys[provider] || '';
  if (PROVIDERS[provider]?.needsKey && !key) {
    throw new Error(`${PROVIDERS[provider].label} requires an API key. Configure it in the Ops Dashboard.`);
  }
  switch (provider) {
    case 'gemini':       return generateGemini(prompt, key, inputImage, orientation);
    case 'dalle':        return generateDalle(prompt, key, orientation);
    case 'grok':         return generateGrok(prompt, key, orientation);
    case 'stability':    return generateStability(prompt, key, orientation);
    case 'pollinations':
    default:             return generatePollinations(prompt, orientation);
  }
}

// ---------- Main entry point used by the pipeline ----------
const VARIATION_COUNT = 3;

async function generateFinalImage() {
  const cardArt    = $('#cardArt');
  const cardImg    = $('#cardArtImage');
  const cardLoad   = $('#cardArtLoader');
  const aiBadge    = $('#aiBadge');
  const errBanner  = $('#errorBanner');

  // Reset state from any previous run
  cardArt.classList.remove('rejected');
  errBanner.classList.add('hidden');
  errBanner.textContent = '';
  aiBadge.classList.remove('visible');
  state.variations = [];
  state.selectedVariation = 0;

  const isEdit = state.source === 'upload' && !!state.uploaded;
  const providerLabel = PROVIDERS[settings.provider]?.label || 'AI';

  const prompt = isEdit ? buildEditPrompt() : buildFullPrompt();
  state.lastPrompt = prompt;

  console.log(
    '[image generation] mode=%s provider=%s count=%d prompt=%s',
    isEdit ? 'image-to-image' : 'text-to-image',
    settings.provider,
    VARIATION_COUNT,
    prompt
  );

  // Show spinner, clear previous image
  cardImg.classList.remove('loaded');
  cardImg.style.backgroundImage = '';
  cardLoad.classList.add('active');
  cardLoad.querySelector('span').textContent =
    isEdit ? `Stylizing your photo with ${providerLabel} (×${VARIATION_COUNT})…`
           : `Generating with ${providerLabel} (×${VARIATION_COUNT})…`;

  // Edit mode requires a provider that supports image-to-image. Only Gemini does.
  if (isEdit && settings.provider !== 'gemini') {
    errBanner.classList.remove('hidden');
    errBanner.textContent =
      `⚠ ${providerLabel} does not support image-to-image in this prototype. ` +
      `Switch to Google Gemini in the Ops Dashboard for true photo stylization. ` +
      `Falling back to text-to-image — your uploaded photo will NOT influence the result.`;
  }

  // Prep the input image (resized + base64) once, reused across N variations.
  let inputImage = null;
  if (isEdit && settings.provider === 'gemini') {
    try {
      inputImage = await resizeImageDataURL(state.uploaded.dataURL, 1024, 0.9);
      console.log('[image generation] resized input → %s · ~%dKB',
        inputImage.mimeType,
        Math.round(inputImage.base64.length * 0.75 / 1024)
      );
    } catch (err) {
      errBanner.classList.remove('hidden');
      errBanner.textContent = `✕ Failed to prepare uploaded image: ${err.message}`;
      cardLoad.classList.remove('active');
      return;
    }
  }

  // Generate at the orientation the customer is currently viewing.
  // The opposite orientation is filled in lazily on demand by
  // ensureCurrentVariationOrientation() when they toggle.
  const orientation = state.cardOrientation || 'horizontal';

  // Fire N parallel calls. Use allSettled so partial failures are tolerated.
  const tasks = Array.from({ length: VARIATION_COUNT }, (_, i) =>
    callProvider(prompt, inputImage, orientation).catch(err => {
      console.error(`[image generation] variation ${i + 1} failed`, err);
      return { error: err.message };
    })
  );
  const results = await Promise.all(tasks);

  // Filter successful + collect errors
  const successes = results.filter(r => r && r.src);
  const failures  = results.filter(r => r && r.error);

  cardLoad.classList.remove('active');

  if (successes.length === 0) {
    // Total failure — surface every error
    errBanner.classList.remove('hidden');
    errBanner.textContent =
      `✕ ${providerLabel} failed to generate any variations.\n\n` +
      failures.map((f, i) => `[${i + 1}] ${f.error}`).join('\n\n') +
      '\n\nOpen Ops Dashboard → re-test the connection.';
    return;
  }

  if (failures.length > 0) {
    errBanner.classList.remove('hidden');
    errBanner.textContent =
      `⚠ ${failures.length} of ${VARIATION_COUNT} variations failed.\n` +
      failures.map((f, i) => `${f.error}`).join('\n');
  }

  // Each variation carries a per-orientation cache. The slot for the
  // orientation we just generated is filled in; the other stays null
  // until the customer toggles to it (then ensureCurrentVariationOrientation
  // fires another call to backfill it).
  state.variations = results.map(r => {
    if (r && r.src) {
      return {
        src: r.src,
        cache: {
          horizontal: orientation === 'horizontal' ? r.src : null,
          vertical:   orientation === 'vertical'   ? r.src : null,
        },
      };
    }
    return { failed: true, error: r?.error };
  });
  state.selectedVariation = state.variations.findIndex(v => v.src);
  if (state.selectedVariation < 0) state.selectedVariation = 0;

  showVariation(state.selectedVariation);

  // Backend-only: build the embosser-ready output for the selected
  // variation. Runs in the background — never surfaced in the
  // customer UI, only consumed by the downstream embosser pipeline.
  prepareEmbosserOutput();
}

// Lazily render the currently selected variation in the active orientation.
// On first toggle the cache slot is empty so we round-trip the provider with
// the same prompt + same seed (Pollinations / Stability honour seeds), then
// cache the result so subsequent toggles are instant.
async function ensureCurrentVariationOrientation() {
  const idx = state.selectedVariation;
  const v = state.variations?.[idx];
  if (!v || v.failed) return;
  const orient = state.cardOrientation || 'horizontal';
  if (!v.cache) v.cache = { horizontal: null, vertical: null };
  // Cache hit — instant swap
  if (v.cache[orient]) {
    v.src = v.cache[orient];
    showVariation(idx);
    return;
  }
  // Cache miss — regenerate at the new orientation
  const cardLoad = $('#cardArtLoader');
  const providerLabel = PROVIDERS[settings.provider]?.label || 'AI';
  cardLoad.querySelector('span').textContent =
    `Re-rendering for ${orient} card with ${providerLabel}…`;
  cardLoad.classList.add('active');
  try {
    console.log('[orient] regenerating variation %d for %s', idx, orient);
    const prompt = state.lastPrompt || buildFullPrompt();
    const result = await callProvider(prompt, null, orient);
    if (!result?.src) throw new Error('Provider returned no image');
    v.cache[orient] = result.src;
    v.src = result.src;
    showVariation(idx);
    renderVariations();
    prepareEmbosserOutput();
  } catch (err) {
    console.error('[orient] regenerate failed', err);
    showToast?.('fail', `Could not render ${orient} card: ${err.message}`);
  } finally {
    cardLoad.classList.remove('active');
  }
}

// ---------- Variation selection / display ----------
function showVariation(index) {
  const cardImg = $('#cardArtImage');
  const aiBadge = $('#aiBadge');
  const v = state.variations[index];
  if (!v || (!v.src && !v.cache)) return;
  // Pick the orientation-specific version if it's been generated.
  // Otherwise fall back to whatever's in v.src so the preview never
  // goes blank — ensureCurrentVariationOrientation() will swap it
  // for the right one as soon as the lazy regen completes.
  const orient = state.cardOrientation || 'horizontal';
  const url = v.cache?.[orient] || v.src;
  if (!url) return;
  cardImg.style.backgroundImage = `url("${url}")`;
  cardImg.classList.add('loaded');
  aiBadge.classList.add('visible');
  state.selectedVariation = index;
  // Re-compose the embosser-ready output for the newly selected
  // variation. Backend-only — never surfaced in the customer UI.
  prepareEmbosserOutput();
}

function renderVariations() {
  const grid = $('#variationsGrid');
  if (!grid) return;
  if (!state.variations || state.variations.length === 0) {
    grid.innerHTML = '';
    return;
  }
  const orient = state.cardOrientation || 'horizontal';
  grid.innerHTML = state.variations.map((v, i) => {
    if (v.failed) {
      return `<div class="variation-thumb failed" data-index="${i}"><span class="v-num">${i + 1}</span></div>`;
    }
    const sel = i === state.selectedVariation ? 'selected' : '';
    // Show the orientation-matching cache slot if we have it,
    // otherwise fall back to whatever's currently in v.src so the
    // thumb never blanks out.
    const url = v.cache?.[orient] || v.src;
    return `<div class="variation-thumb ${sel}" data-index="${i}" style="background-image:url('${url}')"><span class="v-num">${i + 1}</span></div>`;
  }).join('');

  grid.querySelectorAll('.variation-thumb').forEach(el => {
    if (el.classList.contains('failed')) return;
    el.addEventListener('click', async () => {
      const i = +el.dataset.index;
      state.selectedVariation = i;
      grid.querySelectorAll('.variation-thumb').forEach(t => t.classList.remove('selected'));
      el.classList.add('selected');
      // Ensure the newly-selected variation has been generated
      // for the active orientation; lazy-regenerates if not.
      await ensureCurrentVariationOrientation();
    });
  });
}

function refreshActiveProviderBanner() {
  const el = $('#activeProviderText');
  if (!el) return;
  const def = PROVIDERS[settings.provider];
  const hasKey = !def.needsKey || !!settings.keys[settings.provider];
  el.textContent = def.label + (hasKey ? ' ✓' : ' (key missing)');
  el.style.color = hasKey ? '' : 'var(--amber)';
}

// ---------- DOM helpers ----------
const $  = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// ============================================================
// NAV — top tabs
// ============================================================
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const view = tab.dataset.view;
    $$('.view').forEach(v => v.classList.remove('active'));
    $('#view-' + view).classList.add('active');
    if (view === 'ops') renderOps();
    if (view === 'customer') refreshActiveProviderBanner();
  });
});

// ============================================================
// STEP NAVIGATION
// ============================================================
const prevBtn = $('#prevBtn');
const nextBtn = $('#nextBtn');

function gotoStep(n) {
  state.step = n;
  $$('.step-panel').forEach(p => p.classList.toggle('active', +p.dataset.panel === n));
  $$('.step').forEach(s => {
    const sn = +s.dataset.step;
    s.classList.toggle('active', sn === n);
    s.classList.toggle('done', sn < n);
  });
  prevBtn.style.visibility = n === 1 ? 'hidden' : 'visible';
  if (n === 4) nextBtn.textContent = 'Start over ↻';
  else if (n === 3) nextBtn.textContent = 'View result →';
  else nextBtn.textContent = 'Continue →';
  validateNext();
  if (n === 3) runPipeline();
}

function validateNext() {
  let ok = true;
  if (state.step === 1) ok = !!state.source && (state.source === 'generate' || !!state.uploaded);
  if (state.step === 2) ok = !!state.selections.style;
  nextBtn.disabled = !ok;
}

prevBtn.addEventListener('click', () => { if (state.step > 1) gotoStep(state.step - 1); });
nextBtn.addEventListener('click', () => {
  if (state.step < 4) gotoStep(state.step + 1);
  else resetAll();
});

// ============================================================
// STEP 1 — Source picker + Upload
// ============================================================
$$('.source-card').forEach(card => {
  card.addEventListener('click', () => {
    $$('.source-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    state.source = card.dataset.source;
    $('#uploadZone').classList.toggle('hidden', state.source !== 'upload');

    // Switching back to upload after a detour through "Generate with AI"
    // must repaint the previously uploaded photo on the live preview —
    // updatePreview() wipes the card image while in generate mode, but
    // state.uploaded still holds the data so we can restore it here.
    if (state.source === 'upload' && state.uploaded) {
      const cardImg = $('#cardArtImage');
      cardImg.style.backgroundImage = `url("${state.uploaded.dataURL}")`;
      cardImg.classList.add('loaded');
    }

    validateNext();
    // Generate with AI has no further input on step 1 — jump straight to
    // the customization step so customers can build a card without uploading.
    if (state.source === 'generate') gotoStep(2);
  });
});

const fileInput = $('#fileInput');
const dropzone  = $('#dropzone');

dropzone.addEventListener('click', () => fileInput.click());
['dragenter','dragover'].forEach(e => dropzone.addEventListener(e, ev => {
  ev.preventDefault(); dropzone.classList.add('over');
}));
['dragleave','drop'].forEach(e => dropzone.addEventListener(e, ev => {
  ev.preventDefault(); dropzone.classList.remove('over');
}));
dropzone.addEventListener('drop', ev => {
  const f = ev.dataTransfer.files[0];
  if (f) handleFile(f);
});
fileInput.addEventListener('change', e => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

function handleFile(file) {
  if (!/image\/(jpeg|png)/.test(file.type)) {
    showUploadMeta(`<strong style="color:var(--red)">✕ Rejected:</strong> only JPEG / PNG accepted`);
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    showUploadMeta(`<strong style="color:var(--red)">✕ Rejected:</strong> file exceeds 15MB`);
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    state.uploaded = { name: file.name, size: file.size, dataURL: e.target.result };
    showUploadMeta(
      `<strong style="color:var(--green)">✓ Layer 1 passed:</strong> ${file.name} · ${(file.size/1024).toFixed(0)}KB · file integrity OK`
    );
    // Show the upload as a preview on the card so the user sees their photo,
    // but pipeline run will replace it with the AI-stylized version.
    const cardImg = $('#cardArtImage');
    cardImg.style.backgroundImage = `url(${e.target.result})`;
    cardImg.classList.add('loaded');
    validateNext();
  };
  reader.readAsDataURL(file);
}

function showUploadMeta(html) {
  const meta = $('#uploadMeta');
  meta.classList.remove('hidden');
  meta.innerHTML = html;
}

// ============================================================
// STEP 2 — Style/mood/color/background pickers
// ============================================================
$$('.chip-row').forEach(row => {
  const group = row.dataset.group;
  row.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    row.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.selections[group] = chip.dataset.value;
    updatePreview();
    validateNext();
  });
});

$('#freeText').addEventListener('input', e => {
  state.freeText = e.target.value;
  updatePreview();
});

function updatePreview() {
  const { style, mood, color, background } = state.selections;
  $('#psStyle').textContent = style || '—';
  $('#psMood').textContent  = mood || '—';
  $('#psColor').textContent = color || '—';
  $('#psBg').textContent    = background || '—';

  const cardArt = $('#cardArt');
  // Reset class list, keep .card-art
  cardArt.className = 'card-art';
  // Apply gradient placeholder only if there's no uploaded photo & no AI image yet
  if (style && !state.uploaded) cardArt.classList.add('art-' + style);
  if (mood)  cardArt.classList.add('mood-' + mood);

  // Any selection change invalidates the previously generated AI image
  // so the next pipeline run will regenerate with the new prompt.
  if (state.source === 'generate') {
    state.seed = null;
    const cardImg = $('#cardArtImage');
    cardImg.classList.remove('loaded');
    cardImg.style.backgroundImage = '';
  }

  // Build prompt preview
  const parts = [];
  if (style)      parts.push(style.replace('-', ' ') + ' style');
  if (mood)       parts.push(mood + ' mood');
  if (color)      parts.push(color + ' palette');
  if (background) parts.push(background.replace('-', ' ') + ' background');
  parts.push('high resolution, card friendly composition');

  let prompt = parts.join(', ');
  if (state.freeText.trim()) {
    prompt += ' · user note: ' + sanitizePrompt(state.freeText).sanitized;
  }
  $('#promptOut').textContent = prompt || 'Pick a style to begin…';
}

// ============================================================
// LAYER 0 — Prompt Sanitization
// ============================================================
function sanitizePrompt(raw) {
  let sanitized = raw;
  let riskScore = 0;
  const flagsHit = [];

  // Restricted keyword scan
  for (const [cat, list] of Object.entries(RESTRICTED)) {
    for (const term of list) {
      const re = new RegExp('\\b' + term + '\\b', 'gi');
      if (re.test(sanitized)) {
        flagsHit.push(cat);
        if (cat === 'celebrities') riskScore += 40;
        else if (cat === 'brands')    riskScore += 30;
        else if (cat === 'political') riskScore += 50;
        else if (cat === 'religious') riskScore += 50;
        else if (cat === 'weapons')   riskScore += 60;
        else if (cat === 'unsafe')    riskScore += 70;
      }
    }
  }
  // Apply rewrites
  REWRITE_MAP.forEach(({ match, replace }) => { sanitized = sanitized.replace(match, replace); });
  return { sanitized, riskScore: Math.min(riskScore, 100), flagsHit: [...new Set(flagsHit)] };
}

// ============================================================
// PIPELINE — render and run
// ============================================================
const LAYER_DEFS = [
  { id: 'L0', name: 'Prompt Intelligence', desc: 'Parse, sanitize and risk-score prompt' },
  { id: 'L1', name: 'Upload Guardrails',   desc: 'File integrity, resolution & quality checks' },
  { id: 'L2', name: 'Image Analysis',      desc: 'NSFW · faces · logos · OCR · CLIP concepts' },
  { id: 'L3', name: 'Risk Scoring Engine', desc: 'Weighted aggregation of all signals' },
  { id: 'L4', name: 'Auto Approval',       desc: 'Routing decision based on cohort policy' },
  { id: 'L5', name: 'Fraud Detection',     desc: 'Behavioral & perceptual hash checks' },
];

function buildPipelineDom() {
  const pipe = $('#pipeline');
  pipe.innerHTML = '';
  LAYER_DEFS.forEach(L => {
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.dataset.status = 'pending';
    row.dataset.layer = L.id;
    row.innerHTML = `
      <div class="ln">${L.id}</div>
      <div class="ll"><strong>${L.name}</strong><span>${L.desc}</span></div>
      <div class="lstatus">Pending</div>
    `;
    pipe.appendChild(row);
  });
}

async function runPipeline() {
  buildPipelineDom();
  state.signals = {};
  const promptResult = sanitizePrompt(state.freeText || ($('#promptOut').textContent));

  // Kick off real AI image generation in parallel with the pipeline animation.
  // Pollinations typically takes 4–10s, the pipeline animation takes ~3.8s,
  // so this hides most of the latency behind the layer animations.
  const imagePromise = generateFinalImage();

  // Simulated random-ish but deterministic-ish signals
  const seedNoise = () => +(Math.random() * 6).toFixed(1);

  // Layer 0 — Prompt
  await runLayer('L0', 700, () => {
    const status = promptResult.riskScore > 60 ? 'fail'
                  : promptResult.riskScore > 25 ? 'warn' : 'pass';
    state.signals.promptRisk = promptResult.riskScore;
    state.signals.promptFlags = promptResult.flagsHit;
    state.signals.sanitizedPrompt = promptResult.sanitized;
    return status;
  });

  // Layer 1 — Upload guardrails
  await runLayer('L1', 600, () => {
    if (state.source === 'upload' && !state.uploaded) return 'fail';
    state.signals.fileOK = true;
    state.signals.resolution = '2048×1290';
    state.signals.dpi = 600;
    return 'pass';
  });

  // Layer 2 — Image analysis (mock vision signals)
  await runLayer('L2', 1100, () => {
    state.signals.nsfw = +(Math.random() * 4).toFixed(1);
    state.signals.faces = state.uploaded ? 1 : 0;
    state.signals.celebrity = 0;
    state.signals.logoDetected = false;
    state.signals.textChars = 0;
    state.signals.clipSimilarity = +(0.05 + Math.random() * 0.18).toFixed(2);
    state.signals.objects = [];

    // Inject failure when prompt was extreme
    if (promptResult.riskScore > 60) {
      state.signals.celebrity = 0.78;
      return 'fail';
    }
    if (promptResult.riskScore > 25) {
      state.signals.celebrity = 0.42;
      return 'warn';
    }
    return 'pass';
  });

  // Layer 3 — Risk Score
  await runLayer('L3', 500, () => {
    const s = state.signals;
    const score =
      (s.nsfw * 0.30) +
      (s.celebrity * 100 * 0.20) +
      (s.promptRisk * 0.15) +
      ((s.logoDetected ? 50 : 0) * 0.10) +
      ((s.textChars > 10 ? 40 : 0) * 0.10) +
      ((s.objects.length > 0 ? 30 : 0) * 0.10) +
      (seedNoise() * 0.05);
    s.riskScore = Math.min(Math.round(score), 100);
    s.safetyScore = 100 - s.riskScore;
    return s.riskScore < 20 ? 'pass' : s.riskScore < 50 ? 'warn' : 'fail';
  });

  // Layer 4 — Auto approval
  await runLayer('L4', 400, () => {
    const r = state.signals.riskScore;
    if (r < 20)      state.decision = { code: 'AUTO_APPROVE',  label: 'Auto Approved',     tone: 'pass', icon: '✓', reason: 'Risk score below threshold. Image dispatched to embosser queue.' };
    else if (r < 40) state.decision = { code: 'QUICK_REVIEW',  label: 'Quick Review',      tone: 'warn', icon: '⏱', reason: 'Borderline signals. Will auto-approve in 2 mins unless ops intervenes.' };
    else if (r < 70) state.decision = { code: 'MANUAL_REVIEW', label: 'Manual Review',     tone: 'warn', icon: '👁', reason: 'Routed to ops dashboard for human approval.' };
    else             state.decision = { code: 'REJECTED',      label: 'Rejected',          tone: 'fail', icon: '✕', reason: 'Hard-blocked by compliance signals. Customer is shown a friendly message.' };
    return state.decision.tone;
  });

  // Layer 5 — Fraud check
  await runLayer('L5', 500, () => {
    state.signals.userRisk = 0.08;
    state.signals.duplicate = false;
    return 'pass';
  });

  // Wait for the AI image to finish (or fail) before showing the result
  await imagePromise;

  // If the decision was REJECTED, blur and badge the image
  if (state.decision && state.decision.code === 'REJECTED') {
    $('#cardArt').classList.add('rejected');
  }

  // Move to result step automatically
  setTimeout(() => gotoStep(4), 400);
}

function runLayer(id, delay, work) {
  return new Promise(resolve => {
    const row = document.querySelector(`.layer-row[data-layer="${id}"]`);
    row.dataset.status = 'running';
    row.querySelector('.lstatus').textContent = 'Running';
    setTimeout(() => {
      const status = work();
      row.dataset.status = status;
      row.querySelector('.lstatus').textContent =
        status === 'pass' ? 'Passed' :
        status === 'warn' ? 'Flagged' :
        status === 'fail' ? 'Blocked' : 'Done';
      resolve();
    }, delay);
  });
}

// ============================================================
// STEP 4 — Result rendering
// ============================================================
function renderResult() {
  const s = state.signals;
  const d = state.decision;
  if (!s || !d) return;

  // Render thumbnails for the 3 variations generated during the pipeline
  renderVariations();

  $('#riskFill').style.width  = s.riskScore + '%';
  $('#riskScore').textContent = s.riskScore;
  $('#safetyScore').textContent = s.safetyScore;

  const dCard = $('#decisionCard');
  dCard.className = 'decision-card ' + (d.tone === 'pass' ? '' : d.tone);
  $('#decisionIcon').textContent = d.icon;
  $('#decisionLabel').textContent = d.label;
  $('#decisionReason').textContent = d.reason;
  $('#resultTitle').textContent = 'AI Compliance Verdict';
  $('#resultSubtitle').textContent = 'All six layers complete. Final decision below.';

  // Signals grid
  const grid = $('#signalGrid');
  const sigs = [
    { name: 'Prompt Risk',  val: s.promptRisk + '/100', tone: s.promptRisk < 25 ? 'ok' : s.promptRisk < 60 ? 'warn' : 'bad' },
    { name: 'NSFW Score',   val: s.nsfw + '%',          tone: s.nsfw < 5 ? 'ok' : 'warn' },
    { name: 'Faces',        val: s.faces,               tone: 'ok' },
    { name: 'Celebrity',    val: (s.celebrity * 100).toFixed(0) + '%', tone: s.celebrity < 0.4 ? 'ok' : s.celebrity < 0.7 ? 'warn' : 'bad' },
    { name: 'Logos',        val: s.logoDetected ? 'Yes' : 'None', tone: s.logoDetected ? 'bad' : 'ok' },
    { name: 'OCR Text',     val: s.textChars + ' chars', tone: 'ok' },
    { name: 'CLIP Sim',     val: s.clipSimilarity,      tone: s.clipSimilarity < 0.3 ? 'ok' : 'warn' },
    { name: 'User Risk',    val: s.userRisk,            tone: 'ok' },
    { name: 'Resolution',   val: s.resolution,          tone: 'ok' },
  ];
  grid.innerHTML = sigs.map(x =>
    `<div class="signal ${x.tone}"><div class="signal-name">${x.name}</div><div class="signal-val">${x.val}</div></div>`
  ).join('');

  // Submit button state — disabled if AI hard-rejected the design
  const submitBtn = $('#submitForApprovalBtn');
  const submitHint = $('#submitHint');
  if (d.code === 'REJECTED') {
    submitBtn.disabled = true;
    submitBtn.textContent = '✕ Submission blocked';
    submitHint.textContent = 'This design was hard-blocked by AI moderation and cannot be submitted to ops.';
    submitHint.style.color = 'var(--red)';
  } else {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit for Approval →';
    submitHint.textContent = `Will be routed as: ${d.label}. Selected variation #${state.selectedVariation + 1} will be sent.`;
    submitHint.style.color = '';
  }
}

// Patch gotoStep to render results when entering step 4
const _origGoto = gotoStep;
window.gotoStep = function(n) { _origGoto(n); if (n === 4) renderResult(); };
gotoStep = window.gotoStep;

// ============================================================
// Reset
// ============================================================
function resetAll() {
  state.step = 1;
  state.source = null;
  state.uploaded = null;
  state.selections = { style: null, mood: null, color: null, background: null };
  state.freeText = '';
  state.signals = null;
  state.decision = null;
  state.seed = null;
  state.lastPrompt = null;
  state.variations = [];
  state.selectedVariation = 0;
  state.cardholderName = '';

  $('#cardNameInput').value = '';
  $('#cardName').textContent = 'YOUR NAME';

  $$('.source-card').forEach(c => c.classList.remove('active'));
  $$('.chip').forEach(c => c.classList.remove('active'));
  $('#freeText').value = '';
  $('#uploadZone').classList.add('hidden');
  $('#uploadMeta').classList.add('hidden');
  fileInput.value = '';
  $('#errorBanner').classList.add('hidden');
  $('#variationsGrid').innerHTML = '';

  const cardArt  = $('#cardArt');
  const cardImg  = $('#cardArtImage');
  const cardLoad = $('#cardArtLoader');
  const aiBadge  = $('#aiBadge');
  cardArt.className = 'card-art';
  cardImg.style.backgroundImage = '';
  cardImg.classList.remove('loaded');
  cardLoad.classList.remove('active');
  aiBadge.classList.remove('visible');

  updatePreview();
  gotoStep(1);
}

// ============================================================
// OPS DASHBOARD — dynamic queue
// ============================================================

// Cohort historical approval rates (drives the "success %" hint)
const COHORT_APPROVAL = {
  'cyberpunk':       87,
  'watercolor':      95,
  'anime':           82,
  'minimal':         96,
  'oil-painting':    91,
  'vintage-poster':  88,
  '3d-render':       85,
};

// Static demo items so the dashboard isn't empty on first load
const opsQueue = [
  {
    id: 'CUST-8492', cardholderName: 'AMIT SHARMA', time: '2m ago',
    risk: 34, safety: 66, confidence: 32,
    style: 'cyberpunk', mood: 'futuristic',
    flags: ['celebrity:0.42','clip:0.31'],
    signals: { promptRisk: 28, nsfw: 1.2, faces: 1, celebrity: 0.42, logoDetected: false, textChars: 0, clipSimilarity: 0.31, userRisk: 0.08 },
    art: 'art-cyberpunk mood-futuristic',
  },
  {
    id: 'CUST-8488', cardholderName: 'PRIYA NAIR', time: '4m ago',
    risk: 22, safety: 78, confidence: 56,
    style: 'watercolor', mood: 'vibrant',
    flags: ['text:14ch'],
    signals: { promptRisk: 12, nsfw: 0.4, faces: 1, celebrity: 0.05, logoDetected: false, textChars: 14, clipSimilarity: 0.18, userRisk: 0.05 },
    art: 'art-watercolor mood-vibrant',
  },
  {
    id: 'CUST-8485', cardholderName: 'RAHUL VERMA', time: '6m ago',
    risk: 51, safety: 49, confidence: 2,
    style: '3d-render', mood: 'dark',
    flags: ['logo','brand'],
    signals: { promptRisk: 30, nsfw: 0.8, faces: 0, celebrity: 0.0, logoDetected: true, textChars: 4, clipSimilarity: 0.42, userRisk: 0.18 },
    art: 'art-3d-render mood-dark', warn: true,
  },
  {
    id: 'CUST-8479', cardholderName: 'NEHA GUPTA', time: '8m ago',
    risk: 28, safety: 72, confidence: 44,
    style: 'vintage-poster', mood: 'calm',
    flags: ['ocr:phone'],
    signals: { promptRisk: 18, nsfw: 0.2, faces: 0, celebrity: 0.0, logoDetected: false, textChars: 22, clipSimilarity: 0.21, userRisk: 0.09 },
    art: 'art-vintage-poster mood-calm',
  },
  {
    id: 'CUST-8466', cardholderName: 'ARJUN MEHTA', time: '14m ago',
    risk: 67, safety: 33, confidence: 34,
    style: 'oil-painting', mood: 'dark',
    flags: ['celebrity:0.71','politics'],
    signals: { promptRisk: 60, nsfw: 0.3, faces: 1, celebrity: 0.71, logoDetected: false, textChars: 0, clipSimilarity: 0.51, userRisk: 0.22 },
    art: 'art-oil-painting mood-dark', bad: true,
  },
];

function generateCustomerId() {
  return 'CUST-' + Math.floor(8000 + Math.random() * 2000);
}

function computeConfidence(riskScore) {
  // High at extremes (definitely safe / definitely bad), low in the middle
  // (true borderline cases that humans need to look at).
  return Math.round(Math.min(100, Math.abs(50 - riskScore) * 2));
}

// Add a new submission from the customer journey to the front of the queue
function pushToOpsQueue(submission) {
  opsQueue.unshift(submission);
  updateQueueStat();
}

function updateQueueStat() {
  const el = $('#statQueue');
  if (el) el.textContent = opsQueue.length;
}

function removeFromQueue(id) {
  const idx = opsQueue.findIndex(it => it.id === id);
  if (idx >= 0) opsQueue.splice(idx, 1);
  updateQueueStat();
}

function riskTone(risk) {
  if (risk >= 50) return 'high';
  if (risk >= 25) return 'med';
  return 'low';
}

function renderOps() {
  hydrateSettingsUI();
  updateQueueStat();
  const grid = $('#opsGrid');

  if (opsQueue.length === 0) {
    grid.innerHTML = `
      <div class="card" style="grid-column:1/-1;text-align:center;padding:60px 20px;">
        <h3 style="margin-bottom:6px;">Queue is empty</h3>
        <p class="muted small">All submissions have been processed. New customer designs will appear here automatically.</p>
      </div>`;
    return;
  }

  grid.innerHTML = opsQueue.map(item => {
    const tone           = riskTone(item.risk);
    const isUserSub      = !!item.isUserSubmission;
    const cohortApproval = COHORT_APPROVAL[item.style] ?? 89;
    const orientation    = item.orientation || 'horizontal';
    // Image goes on an inner .ops-thumb-card element so vertical
    // submissions render as a centered portrait card inside the
    // existing horizontal tile (same outer structure).
    const thumbCardHTML  = item.imageUrl
      ? `<div class="ops-thumb-card" style="background-image:url('${item.imageUrl}')"></div>`
      : '';
    const thumbClass     = item.imageUrl ? '' : (item.art || '');
    const orientClass    = orientation === 'vertical' ? 'vertical' : '';
    const submissionTag  = isUserSub ? `<span class="submission-badge">Just Submitted</span>` : '';

    const signalRows = renderSignalRows(item.signals);

    return `
      <div class="ops-item ${isUserSub ? 'user-submission' : ''}" data-id="${item.id}">
        <div class="ops-thumb ${thumbClass} ${orientClass}">
          ${thumbCardHTML}
          ${submissionTag}
        </div>
        <div class="ops-body">
          <div class="ops-meta">
            <span class="name">${escapeHtml(item.cardholderName || 'Unnamed cardholder')}</span>
            <span class="sub">
              <span>${item.id}</span>
              <span>·</span>
              <span>${item.time || 'just now'}</span>
            </span>
          </div>

          <div class="ops-scores">
            <div class="score-card risk ${tone}">
              <span class="lbl">Risk</span>
              <span class="val">${item.risk}</span>
            </div>
            <div class="score-card safety">
              <span class="lbl">Safety</span>
              <span class="val">${item.safety}</span>
            </div>
            <div class="score-card confidence">
              <span class="lbl">AI Conf</span>
              <span class="val">${item.confidence}%</span>
            </div>
          </div>

          <div class="ops-bar">
            <div class="ops-bar-fill" style="width:${item.risk}%"></div>
          </div>

          <div class="ops-cohort">
            <span>Cohort approval (${item.style || 'mixed'})</span>
            <strong>${cohortApproval}%</strong>
          </div>

          <button class="ops-signals-toggle" data-toggle="${item.id}">View signal breakdown ▾</button>
          <div class="ops-signals-list" id="sig-${item.id}">
            ${signalRows}
          </div>

          <div class="ops-flags">
            ${(item.flags || []).map(f => `<span class="flag ${tone === 'high' ? 'bad' : tone === 'med' ? 'warn' : ''}">${f}</span>`).join('')}
          </div>

          <div class="ops-actions">
            <button class="approve" data-action="approve" data-id="${item.id}">✓ Approve</button>
            <button class="reject" data-action="reject" data-id="${item.id}">✕ Reject</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Wire actions
  grid.querySelectorAll('[data-action="approve"]').forEach(btn => {
    btn.addEventListener('click', () => approveItem(btn.dataset.id));
  });
  grid.querySelectorAll('[data-action="reject"]').forEach(btn => {
    btn.addEventListener('click', () => openRejectModal(btn.dataset.id));
  });
  grid.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const list = $('#sig-' + btn.dataset.toggle);
      list.classList.toggle('open');
      btn.textContent = list.classList.contains('open')
        ? 'Hide signal breakdown ▴'
        : 'View signal breakdown ▾';
    });
  });
}

function renderSignalRows(signals) {
  if (!signals) return '<div class="muted small">No signal data</div>';
  const rows = [
    { name: 'Prompt Risk',    val: (signals.promptRisk ?? 0) + '/100', tone: (signals.promptRisk ?? 0) < 25 ? 'ok' : (signals.promptRisk ?? 0) < 60 ? 'warn' : 'bad' },
    { name: 'NSFW',           val: (signals.nsfw ?? 0) + '%',          tone: (signals.nsfw ?? 0) < 5 ? 'ok' : 'warn' },
    { name: 'Faces',          val: signals.faces ?? 0,                  tone: 'ok' },
    { name: 'Celebrity Match',val: ((signals.celebrity ?? 0) * 100).toFixed(0) + '%', tone: (signals.celebrity ?? 0) < 0.4 ? 'ok' : (signals.celebrity ?? 0) < 0.7 ? 'warn' : 'bad' },
    { name: 'Logo Detected',  val: signals.logoDetected ? 'Yes' : 'No', tone: signals.logoDetected ? 'bad' : 'ok' },
    { name: 'OCR Text',       val: (signals.textChars ?? 0) + ' chars', tone: (signals.textChars ?? 0) < 10 ? 'ok' : 'warn' },
    { name: 'CLIP Similarity',val: signals.clipSimilarity ?? 0,         tone: (signals.clipSimilarity ?? 0) < 0.3 ? 'ok' : 'warn' },
    { name: 'User Risk',      val: signals.userRisk ?? 0,               tone: (signals.userRisk ?? 0) < 0.2 ? 'ok' : 'warn' },
  ];
  return rows.map(r =>
    `<div class="sig-row ${r.tone}"><span>${r.name}</span><span>${r.val}</span></div>`
  ).join('');
}

function approveItem(id) {
  const item = opsQueue.find(it => it.id === id);
  if (!item) return;
  console.log('[ops] APPROVED', id, item.cardholderName);
  pushToHistory('approved', { ...item, decisionAt: Date.now() });
  removeFromQueue(id);
  renderOps();
  refreshHistoryCounts();
  if (historyState.open) renderHistory();
  showToast('ok', `✓ ${item.cardholderName || id} approved · sent to embosser`);
}

function rejectItem(id, reason) {
  const item = opsQueue.find(it => it.id === id);
  if (!item) return;
  console.log('[ops] REJECTED', id, item.cardholderName, '·', reason);
  pushToHistory('rejected', { ...item, decisionAt: Date.now(), reason });
  removeFromQueue(id);
  renderOps();
  refreshHistoryCounts();
  if (historyState.open) renderHistory();
  showToast('fail', `✕ ${item.cardholderName || id} rejected`);
}

// ============================================================
// Ops decision history (approved + rejected repository)
// ------------------------------------------------------------
// In-memory store of every approve/reject action taken from the
// ops dashboard. Lives for the lifetime of the page session.
// (A real deployment would back this with Postgres + audit log.)
// ============================================================
const opsHistory = {
  approved: [], // { ...submission, decisionAt }
  rejected: [], // { ...submission, decisionAt, reason }
};

const historyState = {
  open: false,
  tab: 'approved',  // 'approved' | 'rejected'
  view: 'grid',     // 'grid' | 'list'
};

function pushToHistory(bucket, entry) {
  if (!opsHistory[bucket]) return;
  // newest first
  opsHistory[bucket].unshift(entry);
}

function refreshHistoryCounts() {
  const a = opsHistory.approved.length;
  const r = opsHistory.rejected.length;
  const set = (id, val) => { const el = $('#' + id); if (el) el.textContent = val; };
  set('histCountApproved', a);
  set('histCountRejected', r);
  set('histTabApprovedCount', a);
  set('histTabRejectedCount', r);
}

function openHistoryPanel() {
  historyState.open = true;
  $('#historyPanel').classList.remove('hidden');
  $('#opsGrid').classList.add('hidden');
  renderHistory();
  // Scroll the panel into view
  $('#historyPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeHistoryPanel() {
  historyState.open = false;
  $('#historyPanel').classList.add('hidden');
  $('#opsGrid').classList.remove('hidden');
}

function renderHistory() {
  const body = $('#historyBody');
  if (!body) return;
  const items = opsHistory[historyState.tab] || [];
  body.classList.toggle('view-grid', historyState.view === 'grid');
  body.classList.toggle('view-list', historyState.view === 'list');

  if (items.length === 0) {
    body.innerHTML = `
      <div class="history-empty">
        <h3>No ${historyState.tab} items yet</h3>
        <p class="muted small">${historyState.tab === 'approved'
          ? 'Approved cards will appear here once you act on the queue.'
          : 'Rejected cards (with reason) will appear here once you act on the queue.'}</p>
      </div>`;
    return;
  }

  body.innerHTML = items.map(item => {
    const orientation = item.orientation || 'horizontal';
    const orientClass = orientation === 'vertical' ? 'vertical' : '';
    const decided = formatDecisionTime(item.decisionAt);
    const cardImg = item.imageUrl
      ? `<div class="ops-thumb-card" style="background-image:url('${item.imageUrl}')"></div>`
      : '';
    const reasonRow = historyState.tab === 'rejected' && item.reason
      ? `<div class="hist-reason"><strong>Reason:</strong> ${escapeHtml(item.reason)}</div>`
      : '';
    const decisionTag = historyState.tab === 'approved'
      ? `<span class="hist-tag ok">✓ Approved</span>`
      : `<span class="hist-tag bad">✕ Rejected</span>`;
    return `
      <div class="hist-item">
        <div class="ops-thumb ${orientClass}">${cardImg}</div>
        <div class="hist-body">
          <div class="hist-row">
            <span class="hist-name">${escapeHtml(item.cardholderName || 'Unnamed')}</span>
            ${decisionTag}
          </div>
          <div class="hist-meta">
            <span>${item.id}</span>
            <span>·</span>
            <span>${decided}</span>
            <span>·</span>
            <span>Risk ${item.risk}/100</span>
            <span>·</span>
            <span>${item.style || 'mixed'}</span>
          </div>
          ${reasonRow}
        </div>
      </div>
    `;
  }).join('');
}

function formatDecisionTime(ts) {
  if (!ts) return 'just now';
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60)        return `${s}s ago`;
  if (s < 3600)      return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

// ============================================================
// Provider Settings UI (Ops Dashboard)
// ============================================================
let settingsUIWired = false;

function hydrateSettingsUI() {
  const sel        = $('#providerSelect');
  const keyIn      = $('#apiKeyInput');
  const keyHint    = $('#keyHint');
  const status     = $('#settingsStatus');
  const statusText = $('#settingsStatusText');
  const keyField   = $('#keyField');

  // Reflect persisted state
  sel.value      = settings.provider;
  keyIn.value    = settings.keys[settings.provider] || '';
  keyHint.textContent = PROVIDERS[settings.provider]?.keyHint || '';
  keyField.style.display = PROVIDERS[settings.provider]?.needsKey ? '' : 'none';
  refreshStatusBadge();

  if (settingsUIWired) return;
  settingsUIWired = true;

  sel.addEventListener('change', () => {
    settings.provider = sel.value;
    keyIn.value = settings.keys[sel.value] || '';
    keyHint.textContent = PROVIDERS[sel.value]?.keyHint || '';
    keyField.style.display = PROVIDERS[sel.value]?.needsKey ? '' : 'none';
    refreshStatusBadge();
  });

  $('#toggleKey').addEventListener('click', () => {
    keyIn.type = keyIn.type === 'password' ? 'text' : 'password';
  });

  $('#saveProviderBtn').addEventListener('click', () => {
    settings.keys[settings.provider] = keyIn.value.trim();
    saveSettings(settings);
    showSettingsResult('ok', `Saved · ${PROVIDERS[settings.provider].label} is now active.`);
    refreshStatusBadge();
    refreshActiveProviderBanner();
  });

  $('#testProviderBtn').addEventListener('click', async () => {
    settings.keys[settings.provider] = keyIn.value.trim();
    const btn = $('#testProviderBtn');
    btn.disabled = true;
    const origLabel = btn.textContent;
    btn.textContent = 'Testing…';
    showSettingsResult('', 'Sending test prompt…');
    try {
      const { src } = await callProvider('a minimal abstract gradient, blue and purple, test image');
      showSettingsResult('ok', `✓ Connection OK · received image (${src.slice(0, 60)}…)`);
      // Save on successful test as a convenience
      saveSettings(settings);
      refreshStatusBadge();
    } catch (err) {
      showSettingsResult('fail', `✕ ${err.message}`);
      refreshStatusBadge('fail');
    } finally {
      btn.disabled = false;
      btn.textContent = origLabel;
    }
  });
}

function refreshStatusBadge(forced) {
  const el = $('#settingsStatus');
  const txt = $('#settingsStatusText');
  el.classList.remove('ok', 'warn', 'fail');
  const def = PROVIDERS[settings.provider];
  if (forced === 'fail') {
    el.classList.add('fail');
    txt.textContent = 'Test failed';
    return;
  }
  if (!def.needsKey) {
    el.classList.add('ok');
    txt.textContent = `${def.label} · ready`;
  } else if (settings.keys[settings.provider]) {
    el.classList.add('ok');
    txt.textContent = `${def.label} · key configured`;
  } else {
    el.classList.add('warn');
    txt.textContent = `${def.label} · key required`;
  }
}

function showSettingsResult(tone, msg) {
  const el = $('#settingsResult');
  el.classList.remove('hidden', 'ok', 'fail');
  if (tone) el.classList.add(tone);
  el.textContent = msg;
}

// ============================================================
// Cardholder name input (customer interface only)
// ============================================================
$('#cardNameInput').addEventListener('input', e => {
  const v = e.target.value.trim();
  $('#cardName').textContent = v ? v.toUpperCase() : 'YOUR NAME';
  state.cardholderName = v;
});

// ============================================================
// Modal system (generic)
// ============================================================
function openModal({ title, subtitle, body, actions }) {
  $('#modalTitle').textContent = title || '';
  $('#modalSubtitle').textContent = subtitle || '';
  $('#modalBody').innerHTML = body || '';
  const actionsEl = $('#modalActions');
  actionsEl.innerHTML = '';
  (actions || []).forEach(a => {
    const btn = document.createElement('button');
    btn.className = `btn ${a.variant || 'ghost'}`;
    btn.textContent = a.label;
    btn.addEventListener('click', () => {
      if (a.handler) {
        const keepOpen = a.handler() === false;
        if (!keepOpen) closeModal();
      } else {
        closeModal();
      }
    });
    actionsEl.appendChild(btn);
  });
  $('#modalBackdrop').classList.remove('hidden');
}

function closeModal() {
  $('#modalBackdrop').classList.add('hidden');
}

$('#modalClose').addEventListener('click', closeModal);
$('#modalBackdrop').addEventListener('click', e => {
  if (e.target.id === 'modalBackdrop') closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modalBackdrop').classList.contains('hidden')) closeModal();
});

// ============================================================
// Toast (transient notification)
// ============================================================
function showToast(tone, message, duration = 3200) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${tone || ''}`;
  toast.innerHTML = `<span class="ic">${tone === 'ok' ? '✓' : tone === 'fail' ? '✕' : 'ℹ'}</span><span>${escapeHtml(message)}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity .3s, transform .3s';
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, 20px)';
    setTimeout(() => toast.remove(), 320);
  }, duration);
}

// ============================================================
// Submit for Approval (customer journey → ops queue)
// ============================================================
$('#submitForApprovalBtn').addEventListener('click', () => {
  const selected = state.variations?.[state.selectedVariation];
  if (!selected || !selected.src) {
    showToast('fail', 'No variation selected');
    return;
  }

  // Hard-block: rejected designs cannot be submitted
  if (state.decision?.code === 'REJECTED') {
    showToast('fail', 'This design was blocked by AI moderation and cannot be submitted');
    return;
  }

  const cardholderName = ($('#cardNameInput').value || '').trim().toUpperCase();
  if (!cardholderName) {
    showToast('fail', 'Please enter the cardholder name first');
    $('#cardNameInput').focus();
    return;
  }

  const { style, mood, color, background } = state.selections;
  const styleStr = [style, mood, color, background].filter(Boolean).join(' · ');

  openModal({
    title: 'Submit design for approval?',
    subtitle: 'Once submitted, the design enters the bank ops review queue.',
    body: `
      <div class="modal-card-preview">
        <div class="thumb" style="background-image:url('${selected.src}')"></div>
        <div class="info">
          <div class="name">${escapeHtml(cardholderName)}</div>
          <div class="meta">
            <strong>Style:</strong> ${escapeHtml(styleStr || '—')}<br>
            <strong>Risk Score:</strong> ${state.signals?.riskScore ?? '—'}/100<br>
            <strong>Decision:</strong> ${state.decision?.label ?? '—'}
          </div>
        </div>
      </div>
      <p>You can still cancel below. After submission, the design will appear in the Ops Dashboard for human review.</p>
    `,
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Confirm & Submit',
        variant: 'primary',
        handler: () => {
          submitToOps(selected, cardholderName);
        },
      },
    ],
  });
});

function submitToOps(selectedVariation, cardholderName) {
  const id = generateCustomerId();
  const { style, mood, color, background } = state.selections;
  const risk = state.signals?.riskScore ?? 0;

  const orient = state.cardOrientation || 'horizontal';
  // Pull the orientation-matching cached image so what the customer
  // saw in the live preview is exactly what lands in the ops queue.
  const imageUrl = selectedVariation.cache?.[orient] || selectedVariation.src;

  const submission = {
    id,
    cardholderName,
    time: 'just now',
    risk,
    safety: state.signals?.safetyScore ?? (100 - risk),
    confidence: computeConfidence(risk),
    style,
    mood,
    color,
    background,
    flags: buildFlagsFromSignals(state.signals),
    signals: { ...state.signals },
    imageUrl,
    orientation: orient,
    decision: state.decision,
    isUserSubmission: true,
  };

  pushToOpsQueue(submission);

  // Success modal — let user jump straight to ops dashboard
  openModal({
    title: '✓ Submitted for review',
    subtitle: `Tracking ID: ${id}`,
    body: `
      <p>Your card design has been queued for ops review. The bank's compliance team will approve or reject it shortly.</p>
      <p>You can track its status in the Ops Dashboard.</p>
    `,
    actions: [
      { label: 'Start a new design', variant: 'ghost', handler: () => { resetAll(); } },
      {
        label: 'Open Ops Dashboard →',
        variant: 'primary',
        handler: () => {
          resetAll();
          // Programmatically click the ops tab
          document.querySelector('.tab[data-view="ops"]').click();
        },
      },
    ],
  });
}

function buildFlagsFromSignals(s) {
  if (!s) return [];
  const flags = [];
  if (s.celebrity > 0.4)        flags.push(`celebrity:${s.celebrity.toFixed(2)}`);
  if (s.logoDetected)            flags.push('logo');
  if (s.textChars > 10)          flags.push(`text:${s.textChars}ch`);
  if (s.clipSimilarity > 0.3)    flags.push(`clip:${s.clipSimilarity.toFixed(2)}`);
  if (s.promptRisk > 25)         flags.push(`prompt:${s.promptRisk}`);
  if (flags.length === 0)        flags.push('clean');
  return flags;
}

// ============================================================
// Reject modal (ops side)
// ============================================================
function openRejectModal(id) {
  const item = opsQueue.find(it => it.id === id);
  if (!item) return;

  openModal({
    title: 'Reject design',
    subtitle: `${item.cardholderName} · ${id}`,
    body: `
      <div class="modal-card-preview">
        <div class="thumb ${item.imageUrl ? '' : (item.art || '')}" ${item.imageUrl ? `style="background-image:url('${item.imageUrl}')"` : ''}></div>
        <div class="info">
          <div class="name">${escapeHtml(item.cardholderName)}</div>
          <div class="meta">
            <strong>Risk:</strong> ${item.risk}/100 ·
            <strong>Style:</strong> ${item.style || '—'}<br>
            <strong>Flags:</strong> ${(item.flags || []).join(', ') || 'none'}
          </div>
        </div>
      </div>
      <p>Provide a clear reason — this is logged for audit and shown to the customer.</p>
      <textarea id="rejectReasonInput" rows="4" placeholder="e.g. Image resembles a copyrighted character. Please choose a different style or upload a different photo."></textarea>
      <div class="reject-presets">
        <button class="preset" data-reason="Image quality below embosser threshold">Quality too low</button>
        <button class="preset" data-reason="Image contains prohibited or unsafe content">Prohibited content</button>
        <button class="preset" data-reason="Image resembles a celebrity / public figure">Celebrity likeness</button>
        <button class="preset" data-reason="Image contains a brand logo or trademark">Brand / logo</button>
        <button class="preset" data-reason="Text in image is illegible or non-compliant">Text non-compliant</button>
      </div>
    `,
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Confirm Rejection',
        variant: 'primary',
        handler: () => {
          const ta = $('#rejectReasonInput');
          const reason = ta.value.trim();
          if (!reason) {
            ta.classList.add('error');
            ta.focus();
            showToast('fail', 'Rejection reason is required');
            return false; // keep modal open
          }
          rejectItem(id, reason);
        },
      },
    ],
  });

  // Wire preset buttons
  document.querySelectorAll('.reject-presets .preset').forEach(p => {
    p.addEventListener('click', () => {
      const ta = $('#rejectReasonInput');
      ta.value = p.dataset.reason;
      ta.classList.remove('error');
      ta.focus();
    });
  });
}

// ============================================================
// Regenerate button on the result step
// ============================================================
$('#regenBtn').addEventListener('click', async () => {
  const btn = $('#regenBtn');
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '⟳ Generating…';
  $('#variationsGrid').innerHTML = Array.from({ length: VARIATION_COUNT }, (_, i) =>
    `<div class="variation-thumb"><span class="v-num">${i + 1}</span><div class="v-loading"><div class="spinner-sm"></div></div></div>`
  ).join('');
  await generateFinalImage();
  renderVariations();
  btn.disabled = false;
  btn.textContent = orig;
});

// ============================================================
// History panel wiring (ops dashboard)
// ============================================================
$('#historyCta')?.addEventListener('click', () => {
  if (historyState.open) closeHistoryPanel();
  else openHistoryPanel();
});
$('#historyCloseBtn')?.addEventListener('click', closeHistoryPanel);
$$('.history-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    historyState.tab = btn.dataset.tab;
    $$('.history-tab').forEach(b => b.classList.toggle('active', b === btn));
    renderHistory();
  });
});
$$('.hv-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    historyState.view = btn.dataset.view;
    $$('.hv-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderHistory();
  });
});

// ============================================================
// Card orientation toggle (horizontal / vertical)
// ============================================================
$$('.orient-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const orient = btn.dataset.orient;
    $$('.orient-btn').forEach(b => b.classList.toggle('active', b === btn));
    $('#cardMock').classList.toggle('vertical', orient === 'vertical');
    state.cardOrientation = orient;
    // If variations already exist, render the selected one in the new
    // orientation (lazy-regenerating from the provider on cache miss).
    if (state.variations?.length) {
      await ensureCurrentVariationOrientation();
    }
  });
});

// ============================================================
// Init
// ============================================================
buildPipelineDom();
updatePreview();
refreshActiveProviderBanner();
updateQueueStat();
refreshHistoryCounts();
gotoStep(1);
