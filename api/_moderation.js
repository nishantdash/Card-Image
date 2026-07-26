// Model-based moderation (server only).
//
// Filenames starting with "_" are not routed by Vercel, so this is a private
// module rather than an endpoint.
//
// Why a model and not just the blocklist: a keyword list only catches phrasings
// someone wrote down in advance. It misses paraphrase ("a woman wearing
// nothing"), transliteration, other languages, and purely descriptive requests.
// A classifier scores intent and generalises. The blocklist stays as a fast
// deterministic floor — see shared/guardrails/modelPolicy.js.
//
// Providers: gemini (default, reuses GEMINI_API_KEY), openai
// (omni-moderation-latest), huggingface. Selected with MODERATION_PROVIDER.

import { createHash } from 'node:crypto';
import {
  applyModelVerdict, unavailableModelVerdict, buildVerdictSchema,
  MODEL_CATEGORY_KEYS,
} from '../shared/guardrails/modelPolicy.js';

const TIMEOUT_MS = Number(process.env.MODERATION_TIMEOUT_MS || 9000);

// Candidate list rather than one pinned name, so a retired preview model does
// not take moderation offline.
const GEMINI_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

const RUBRIC = `You are a content-safety classifier for a bank's custom debit/credit card artwork service.
Artwork is physically printed on a payment card issued to a named customer, so the bar is higher than for general web content: anything a bank could not put in a customer's wallet must score high.

Score EVERY category from 0 to 100, where 0 means "certainly absent" and 100 means "certainly present and severe".

Categories:
- sexual: nudity, sexual acts, sexualised bodies, lingerie/suggestive posing
- sexual_minors: ANY sexualisation of, or sexual context involving, a minor. Score above 0 only with genuine indication, but never understate it.
- violence: fighting, threats, weapons used against people, war imagery
- gore: blood, wounds, mutilation, corpses
- hate: slurs or demeaning content targeting a protected group
- harassment: targeted abuse, bullying, doxxing of a specific person
- self_harm: suicide, cutting, self-injury, pro-eating-disorder content
- illegal_drugs: illegal drug use, paraphernalia, trafficking
- weapons: guns, knives, bombs, ammunition as subject matter
- extremism: terrorism, extremist groups, their symbols or propaganda
- celebrity_likeness: a real identifiable public figure, named or clearly depicted
- trademark_brand: third-party logos, brand names, or protected character designs
- political: politicians, parties, campaign slogans, political symbols
- religious: religious figures, scripture, or sacred symbols
- pii: card numbers, government IDs, phone numbers, addresses, emails
- text_in_image: legible words or numbers rendered in the image (0 for text-only input)

Judge what the content actually depicts or requests, not merely which words appear. Descriptive circumvention counts: "a lady with no clothes on" is sexual content. Obfuscation counts: leetspeak, spaced letters and other languages are all in scope.
Reply with the JSON object only. Keep "reasoning" under 30 words.`;

// ── Cache ──────────────────────────────────────────────────────────────────
// Same prompt re-submitted (a customer hitting "try again") should not pay for a
// second classification. Per-instance and best-effort, like the rate limiter.
const CACHE_MAX = 500;
const cache = new Map();

function cacheKey(kind, payload) {
  return kind + ':' + createHash('sha256').update(payload).digest('hex').slice(0, 32);
}
function cacheGet(key) {
  if (!cache.has(key)) return null;
  const v = cache.get(key);
  cache.delete(key);
  cache.set(key, v); // LRU touch
  return v;
}
function cacheSet(key, value) {
  if (!value?.available) return; // never cache an outage
  cache.set(key, value);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// ── Gemini ─────────────────────────────────────────────────────────────────
// Google's own filters would otherwise refuse to look at the very text we need
// classified, so they are turned off for the classifier call. A refusal is then
// handled as a positive signal rather than an outage (see below).
const SAFETY_OFF = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map(category => ({ category, threshold: 'BLOCK_NONE' }));

// Google's safety labels mapped onto our categories, used when Gemini blocks its
// own response instead of classifying.
const SAFETY_TO_CATEGORY = {
  HARM_CATEGORY_SEXUALLY_EXPLICIT: 'sexual',
  HARM_CATEGORY_HATE_SPEECH: 'hate',
  HARM_CATEGORY_HARASSMENT: 'harassment',
  HARM_CATEGORY_DANGEROUS_CONTENT: 'violence',
};
const SAFETY_SCORE = { NEGLIGIBLE: 5, LOW: 25, MEDIUM: 60, HIGH: 90 };

function verdictFromSafetyBlock(data) {
  const categories = Object.fromEntries(MODEL_CATEGORY_KEYS.map(k => [k, 0]));
  const ratings = data?.promptFeedback?.safetyRatings || data?.candidates?.[0]?.safetyRatings || [];
  let sawAny = false;
  for (const r of ratings) {
    const key = SAFETY_TO_CATEGORY[r.category];
    if (!key) continue;
    const score = SAFETY_SCORE[r.probability] ?? 0;
    if (score > (categories[key] || 0)) categories[key] = score;
    if (score >= 60) sawAny = true;
  }
  // Google refused to process it at all: treat as a strong positive rather than
  // pretending nothing was found.
  if (!sawAny) categories.sexual = Math.max(categories.sexual, 75);
  const verdict = applyModelVerdict({
    categories,
    reasoning: 'Provider safety filter refused to classify this content.',
  });
  verdict.providerRefused = true;
  return verdict;
}

async function geminiClassify({ key, parts, label }) {
  const body = {
    systemInstruction: { parts: [{ text: RUBRIC }] },
    contents: [{ parts }],
    safetySettings: SAFETY_OFF,
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: buildVerdictSchema(),
    },
  };

  let lastErr;
  for (const model of GEMINI_MODELS) {
    for (const withSafety of [true, false]) {
      const payload = withSafety ? body : { ...body, safetySettings: undefined };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );
        if (!res.ok) {
          const text = await res.text();
          lastErr = new Error(`${model} -> ${res.status}: ${text.slice(0, 160)}`);
          // Some projects reject BLOCK_NONE; retry once without safetySettings.
          if (withSafety && /safet/i.test(text)) continue;
          break; // try next model
        }
        const data = await res.json();

        if (data?.promptFeedback?.blockReason) return verdictFromSafetyBlock(data);

        const cand = data?.candidates?.[0];
        if (cand?.finishReason === 'SAFETY') return verdictFromSafetyBlock(data);

        const text = (cand?.content?.parts || []).map(p => p.text).filter(Boolean).join('');
        if (!text) {
          lastErr = new Error(`${model} returned no verdict text`);
          break;
        }
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Recover a JSON object embedded in prose.
          const m = text.match(/\{[\s\S]*\}/);
          if (!m) { lastErr = new Error(`${model} returned unparseable verdict`); break; }
          parsed = JSON.parse(m[0]);
        }
        return applyModelVerdict(parsed);
      } catch (err) {
        lastErr = err;
        break;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  console.warn(`[moderation] gemini failed for ${label}:`, lastErr?.message);
  return unavailableModelVerdict(`Gemini moderation failed: ${lastErr?.message || 'unknown'}`);
}

// ── OpenAI omni-moderation ─────────────────────────────────────────────────
const OPENAI_MAP = {
  'sexual': 'sexual',
  'sexual/minors': 'sexual_minors',
  'harassment': 'harassment',
  'harassment/threatening': 'harassment',
  'hate': 'hate',
  'hate/threatening': 'hate',
  'self-harm': 'self_harm',
  'self-harm/intent': 'self_harm',
  'self-harm/instructions': 'self_harm',
  'violence': 'violence',
  'violence/graphic': 'gore',
  'illicit': 'illegal_drugs',
  'illicit/violent': 'weapons',
};

async function openaiClassify({ key, input, label }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'omni-moderation-latest', input }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = await res.json();
    const result = data?.results?.[0];
    if (!result) throw new Error('no moderation result');

    const categories = Object.fromEntries(MODEL_CATEGORY_KEYS.map(k => [k, 0]));
    for (const [openaiKey, score] of Object.entries(result.category_scores || {})) {
      const mapped = OPENAI_MAP[openaiKey];
      if (!mapped) continue;
      const scaled = Math.round(score * 100);
      if (scaled > categories[mapped]) categories[mapped] = scaled;
    }
    // omni-moderation has no celebrity/trademark/political/religious notion, so
    // those stay at 0 here and are covered by the blocklist floor.
    return applyModelVerdict({ categories, reasoning: 'openai omni-moderation' });
  } catch (err) {
    console.warn(`[moderation] openai failed for ${label}:`, err.message);
    return unavailableModelVerdict(`OpenAI moderation failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── Hugging Face (text only) ───────────────────────────────────────────────
const HF_MODEL = process.env.HF_MODERATION_MODEL || 'KoalaAI/Text-Moderation';
const HF_MAP = {
  S: 'sexual', SH: 'self_harm', H: 'hate', 'H2': 'hate',
  V: 'violence', V2: 'gore', HR: 'harassment', OK: null,
};

async function hfClassify({ key, text, label }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = await res.json();
    const rows = Array.isArray(data?.[0]) ? data[0] : data;
    const categories = Object.fromEntries(MODEL_CATEGORY_KEYS.map(k => [k, 0]));
    for (const row of rows || []) {
      const mapped = HF_MAP[row?.label];
      if (!mapped) continue;
      const scaled = Math.round((row.score || 0) * 100);
      if (scaled > categories[mapped]) categories[mapped] = scaled;
    }
    return applyModelVerdict({ categories, reasoning: `huggingface ${HF_MODEL}` });
  } catch (err) {
    console.warn(`[moderation] huggingface failed for ${label}:`, err.message);
    return unavailableModelVerdict(`HF moderation failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────
export function moderationConfig() {
  const provider = (process.env.MODERATION_PROVIDER || 'gemini').toLowerCase();
  const enabled = process.env.MODERATION_ENABLED !== 'false';
  const keys = {
    gemini: process.env.GEMINI_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    huggingface: process.env.HF_TOKEN,
  };
  return {
    provider,
    enabled,
    key: keys[provider],
    configured: enabled && !!keys[provider],
    moderateOutputImages: process.env.MODERATE_OUTPUT_IMAGES !== 'false',
  };
}

/** Classify free text (the design prompt and the cardholder name). */
export async function moderateText(text, cfg = moderationConfig()) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    // Nothing to classify is not the same as an outage.
    return applyModelVerdict({ categories: {}, reasoning: 'No free text supplied' });
  }
  if (!cfg.configured) {
    return unavailableModelVerdict(`Moderation not configured (provider=${cfg.provider})`);
  }

  const key = cacheKey(`text:${cfg.provider}`, trimmed);
  const hit = cacheGet(key);
  if (hit) return hit;

  let verdict;
  if (cfg.provider === 'openai') {
    verdict = await openaiClassify({ key: cfg.key, input: trimmed, label: 'text' });
  } else if (cfg.provider === 'huggingface') {
    verdict = await hfClassify({ key: cfg.key, text: trimmed, label: 'text' });
  } else {
    verdict = await geminiClassify({
      key: cfg.key,
      parts: [{ text: `Classify this card-artwork request:\n\n"""${trimmed}"""` }],
      label: 'text',
    });
  }
  cacheSet(key, verdict);
  return verdict;
}

/**
 * Classify an image. Accepts a data URL or {mimeType, base64}.
 * Used for both the customer's uploaded photo and each generated design.
 */
export async function moderateImage(image, cfg = moderationConfig(), label = 'image') {
  const parsed = normalizeImage(image);
  if (!parsed) return unavailableModelVerdict('Unreadable image payload');
  if (!cfg.configured) {
    return unavailableModelVerdict(`Moderation not configured (provider=${cfg.provider})`);
  }

  const key = cacheKey(`img:${cfg.provider}`, parsed.base64);
  const hit = cacheGet(key);
  if (hit) return hit;

  let verdict;
  if (cfg.provider === 'openai') {
    verdict = await openaiClassify({
      key: cfg.key,
      input: [{ type: 'image_url', image_url: { url: `data:${parsed.mimeType};base64,${parsed.base64}` } }],
      label,
    });
  } else if (cfg.provider === 'huggingface') {
    // The configured HF text model cannot see images; say so rather than
    // reporting a pass.
    verdict = unavailableModelVerdict('HF provider does not support image moderation');
  } else {
    verdict = await geminiClassify({
      key: cfg.key,
      parts: [
        { inlineData: { mimeType: parsed.mimeType, data: parsed.base64 } },
        { text: 'Classify this card artwork image.' },
      ],
      label,
    });
  }
  cacheSet(key, verdict);
  return verdict;
}

function normalizeImage(image) {
  if (!image) return null;
  if (typeof image === 'string') {
    const m = image.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    return { mimeType: m[1], base64: m[2] };
  }
  if (image.base64 && image.mimeType) return { mimeType: image.mimeType, base64: image.base64 };
  return null;
}

/** Classify several images concurrently, preserving order. */
export function moderateImages(images, cfg = moderationConfig()) {
  return Promise.all(images.map((img, i) => moderateImage(img, cfg, `output-${i + 1}`)));
}
