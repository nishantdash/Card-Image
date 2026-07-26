import { evaluateSubmission } from '../../shared/guardrails/index.js';
import {
  buildStyleText, buildFullPrompt, buildEditPrompt, sanitizeOrientation,
} from '../../shared/prompt.js';

// Generation transport.
//
// Default path is POST /api/generate, which holds the provider key and makes the
// binding guardrail decision. The browser no longer talks to a provider and no
// longer carries a key.
//
// The direct-to-provider path is retained for local development where no
// serverless runtime is running. It is opt-in, it still applies the guardrails
// locally, and it is unavailable in a production build — a client-side check is
// bypassable, so it must never be the only check on a deployed site.
const DIRECT_MODE =
  import.meta.env.VITE_ALLOW_DIRECT_PROVIDER === 'true' && import.meta.env.DEV;

export const IS_SERVER_ENFORCED = !DIRECT_MODE;

export const PROVIDERS = {
  server: {
    label: 'Server-enforced (Google Gemini)',
    needsKey: false,
    keyHint: '(key held server-side in GEMINI_API_KEY — never sent to the browser)',
  },
  pollinations: { label: 'Pollinations.ai', needsKey: false, keyHint: '(local dev only)' },
  gemini:       { label: 'Google Gemini · Nano Banana', needsKey: true, keyHint: '(local dev only)' },
  dalle:        { label: 'OpenAI DALL·E 3', needsKey: true, keyHint: '(local dev only)' },
  grok:         { label: 'xAI Grok Image', needsKey: true, keyHint: '(local dev only)' },
  stability:    { label: 'Stability AI', needsKey: true, keyHint: '(local dev only)' },
};

const PROVIDER_TIMEOUT_MS = 25000;

// ── Uploaded-image preparation ─────────────────────────────────────────────
export function resizeImageDataURL(dataURL, maxDim = 1024, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const out = canvas.toDataURL('image/jpeg', quality);
      const match = out.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return reject(new Error('Failed to encode resized image'));
      resolve({ dataURL: out, mimeType: match[1], base64: match[2] });
    };
    img.onerror = () => reject(new Error('Failed to decode uploaded image'));
    img.src = dataURL;
  });
}

// ── Offline fallback artwork ───────────────────────────────────────────────
// Only ever used when generation was ALLOWED and the provider itself failed.
// It must never stand in for a rejected submission — that would render a block
// as a success.
const FALLBACK_PALETTES = {
  warm:       { from: '#ff8a5c', to: '#5c1e0c', accent: '#ffd28a' },
  cool:       { from: '#5b8cff', to: '#0d1c40', accent: '#7fe3ff' },
  monochrome: { from: '#4a4a4c', to: '#0c0c0e', accent: '#c9c9cc' },
  pastel:     { from: '#ffd1dc', to: '#4c5a86', accent: '#ffffff' },
  neon:       { from: '#ff00d4', to: '#10032a', accent: '#00f0ff' },
  _default:   { from: '#d4af37', to: '#17110a', accent: '#ffe9a8' },
};

export function buildFallbackArt(selections = {}, orientation = 'horizontal', seed = 1) {
  const pal = FALLBACK_PALETTES[selections.color] || FALLBACK_PALETTES._default;
  const [w, h] = orientation === 'vertical' ? [540, 864] : [864, 540];
  const angle = seed % 360;
  const hx = (seed * 37) % 100;
  const hy = (seed * 53) % 100;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="g" gradientTransform="rotate(${angle} 0.5 0.5)">
        <stop offset="0" stop-color="${pal.from}"/>
        <stop offset="1" stop-color="${pal.to}"/>
      </linearGradient>
      <radialGradient id="glow" cx="${hx}%" cy="${hy}%" r="70%">
        <stop offset="0" stop-color="${pal.accent}" stop-opacity="0.55"/>
        <stop offset="1" stop-color="${pal.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <rect width="${w}" height="${h}" fill="url(#glow)"/>
    <g stroke="${pal.accent}" stroke-opacity="0.22" fill="none">
      <path d="M0 ${h * 0.72} Q ${w * 0.5} ${h * 0.55} ${w} ${h * 0.78}"/>
      <path d="M0 ${h * 0.82} Q ${w * 0.5} ${h * 0.66} ${w} ${h * 0.88}"/>
      <path d="M0 ${h * 0.62} Q ${w * 0.5} ${h * 0.45} ${w} ${h * 0.68}"/>
    </g>
    <rect width="${w}" height="${h}" fill="#000" fill-opacity="0.06"/>
  </svg>`;
  return { src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), fallback: true };
}

// ── Server path (default) ──────────────────────────────────────────────────
async function generateViaServer({
  selections, freeText, cardholderName, orientation, inputImage, variations, signal,
}) {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // `signal` lets the customer cancel a run in flight; the browser drops the
    // request and fetch rejects with an AbortError.
    signal,
    body: JSON.stringify({
      selections, freeText, cardholderName, orientation, variations,
      inputImage: inputImage
        ? { mimeType: inputImage.mimeType, base64: inputImage.base64 }
        : null,
    }),
  });

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`Server returned ${res.status} with an unreadable body`);
  }

  // 422 is the guardrail refusal. It carries the authoritative verdict, so it is
  // a valid outcome rather than a transport failure.
  if (res.status === 422) {
    return { images: [], verdict: payload, refused: true };
  }
  if (!res.ok) {
    const err = new Error(payload?.error || `Server returned ${res.status}`);
    err.verdict = payload;
    throw err;
  }
  return { images: payload.images || [], verdict: payload, refused: false };
}

// ── Direct path (local development only) ───────────────────────────────────
async function generatePollinations(prompt, orientation, seedRef, signal) {
  const safe = prompt.replace(/[^\w ,.\-]/g, '').slice(0, 380);
  const seed = seedRef.current || Math.floor(Math.random() * 100000);
  seedRef.current = seed;
  const [w, h] = orientation === 'vertical' ? [540, 864] : [864, 540];
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(safe)}?width=${w}&height=${h}&nologo=true&seed=${seed}`;
  await new Promise((res, rej) => {
    const img = new Image();
    let done = false;
    const finish = (fn, arg) => { if (!done) { done = true; cleanup(); fn(arg); } };
    const timer = setTimeout(
      () => finish(rej, new Error(`Pollinations timed out after ${PROVIDER_TIMEOUT_MS / 1000}s`)),
      PROVIDER_TIMEOUT_MS,
    );
    // Cancelling clears src so the browser stops fetching the image.
    const onAbort = () => { img.src = ''; finish(rej, abortError()); };
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    signal?.addEventListener('abort', onAbort);
    img.onload = () => finish(res);
    img.onerror = () => finish(rej, new Error('Pollinations request failed'));
    img.src = url;
  });
  return url;
}

async function generateGeminiDirect(prompt, key, inputImage, orientation, signal) {
  const models = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image-preview'];
  const parts = [];
  if (inputImage) parts.push({ inlineData: { mimeType: inputImage.mimeType, data: inputImage.base64 } });
  parts.push({ text: prompt });
  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: orientation === 'vertical' ? '9:16' : '16:9' },
    },
  };
  let lastErr;
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
          signal,
        },
      );
      if (!res.ok) {
        lastErr = new Error(`${model} -> ${res.status}`);
        if (res.status === 404 || res.status === 400) continue;
        throw lastErr;
      }
      const data = await res.json();
      const respParts = data?.candidates?.[0]?.content?.parts || [];
      const imgPart = respParts.find(p => p.inlineData || p.inline_data);
      if (!imgPart) { lastErr = new Error(`${model} returned no image`); continue; }
      const inline = imgPart.inlineData || imgPart.inline_data;
      return `data:${inline.mimeType || inline.mime_type};base64,${inline.data}`;
    } catch (err) {
      // A cancellation must not be retried against the next model variant.
      if (err.name === 'AbortError') throw err;
      lastErr = err;
    }
  }
  throw lastErr || new Error('All Gemini model variants failed');
}

function abortError() {
  const err = new Error('Generation cancelled');
  err.name = 'AbortError';
  return err;
}

async function generateDirect({
  settings, selections, safeFreeText, orientation, inputImage, variations, seedRef, signal,
}) {
  if (signal?.aborted) throw abortError();
  const provider = settings.provider === 'server' ? 'pollinations' : settings.provider;
  const key = settings.keys?.[provider] || '';
  if (PROVIDERS[provider]?.needsKey && !key) {
    throw new Error(`${PROVIDERS[provider].label} requires an API key. Configure it in the Ops Dashboard.`);
  }
  const prompt = inputImage
    ? buildEditPrompt(selections, safeFreeText)
    : buildFullPrompt(selections, safeFreeText);

  const one = async () => {
    if (signal?.aborted) throw abortError();
    if (provider === 'gemini') return generateGeminiDirect(prompt, key, inputImage, orientation, signal);
    return generatePollinations(prompt, orientation, seedRef, signal);
  };

  const settled = await Promise.all(
    Array.from({ length: variations }, () => one().then(
      src => ({ ok: true, src }),
      err => ({ ok: false, error: err.message }),
    )),
  );
  return {
    images: settled.filter(r => r.ok).map(r => r.src),
    errors: settled.filter(r => !r.ok).map(r => r.error),
    prompt,
  };
}

/**
 * Request generation.
 *
 * @returns {{
 *   images: string[], verdict: object, refused: boolean,
 *   enforcedBy: 'server'|'client', errors?: string[]
 * }}
 */
export async function requestGeneration({
  settings, selections, freeText, cardholderName, orientation, inputImage,
  variations = 3, seedRef = { current: null }, signal,
}) {
  const orient = sanitizeOrientation(orientation);

  if (!DIRECT_MODE) {
    const out = await generateViaServer({
      selections, freeText, cardholderName, orientation: orient,
      inputImage, variations, signal,
    });
    return { ...out, enforcedBy: 'server' };
  }

  // Direct mode still runs the guardrails; it just cannot prove it did.
  const verdict = evaluateSubmission({
    freeText,
    styleText: buildStyleText(selections),
    cardholderName,
    hasUpload: !!inputImage,
    detectors: {
      nsfw: { available: false, value: null },
      celebrity: { available: false, value: null },
      logo: { available: false, value: null },
      ocrText: { available: false, value: null },
    },
  });

  if (!verdict.allowGeneration) {
    return { images: [], verdict, refused: true, enforcedBy: 'client' };
  }

  const out = await generateDirect({
    settings, selections, safeFreeText: verdict.safeFreeText,
    orientation: orient, inputImage, variations, seedRef,
  });
  return {
    images: out.images,
    errors: out.errors,
    verdict: { ...verdict, prompt: out.prompt },
    refused: false,
    enforcedBy: 'client',
  };
}
