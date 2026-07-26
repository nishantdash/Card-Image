// Authoritative generation endpoint.
//
// This is the only place that may talk to an image provider. It exists because
// the guardrails used to run exclusively in the browser, which made them a
// suggestion: the prompt went straight from the customer's device to the
// provider with a VITE_-inlined key, so there was no point in the path where a
// policy could actually be enforced.
//
// Rules for this file:
//   * The client's guardrail verdict is never trusted. Every decision is
//     recomputed here from the raw inputs.
//   * A hard block returns 422 and never calls the image provider.
//   * Style selections are validated against a closed vocabulary rather than
//     concatenated into the prompt as-is.
//   * The provider key lives in a server-only env var and is never returned.
//
// Moderation runs in three passes, cheapest first:
//   A. deterministic blocklists — free, instant, stops the obvious
//   B. model classification of the prompt, name and uploaded photo
//   C. model classification of the GENERATED images
//
// Pass C matters: a clean prompt can still produce unsafe output, and before it
// existed nothing ever looked at what the provider actually returned.

import { evaluateSubmission, mergeModelVerdicts } from '../shared/guardrails/index.js';
import {
  buildFullPrompt, buildEditPrompt, buildStyleText,
  sanitizeSelections, sanitizeOrientation,
} from '../shared/prompt.js';
import {
  moderationConfig, moderateText, moderateImage, moderateImages,
} from './_moderation.js';
import { signVerdict } from './_verdict.js';
import { assessEmbosserFit } from '../shared/imageMeta.js';
import { providerAspects } from '../shared/cardGeometry.js';

const MAX_VARIATIONS = 4;
const MAX_FREETEXT = 500;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // base64-decoded
const PROVIDER_TIMEOUT_MS = 25000;

// ── Rate limiting ──────────────────────────────────────────────────────────
// Best-effort only: serverless instances are per-region and recycled, so this
// caps casual abuse but is not a real quota. A durable store (Vercel KV, Redis)
// is required for an actual limit — flagged rather than silently pretended.
const RATE_LIMIT = { windowMs: 60_000, max: 12 };
const hits = new Map();

function rateLimited(key) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear(); // crude memory bound
  return recent.length > RATE_LIMIT.max;
}

function clientKey(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || 'unknown';
}

// ── Provider ───────────────────────────────────────────────────────────────
const GEMINI_IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-2.5-flash-image-preview',
];

// Card artwork is printed at 1713x1080 @ 600 DPI, so a default-resolution
// generation would be upscaled by the compositor and print soft. Ask for the
// largest size the model supports and fall back if it rejects the field — not
// every model variant accepts imageSize.
const IMAGE_SIZE_ATTEMPTS = ['2K', null];

async function generateGemini({ prompt, key, inputImage, orientation }) {
  const parts = [];
  if (inputImage) {
    parts.push({ inlineData: { mimeType: inputImage.mimeType, data: inputImage.base64 } });
  }
  parts.push({ text: prompt });

  const bodyFor = (aspectRatio, imageSize) => ({
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio,
        ...(imageSize ? { imageSize } : {}),
      },
    },
  });

  // Closest supported ratio to the card's 1.586:1 first. Previously this asked
  // for 16:9 (1.778), so every render was noticeably wider than the card and the
  // sides were cropped away — by a varying amount, because different model
  // variants return different pixel sizes.
  const aspects = providerAspects(orientation);

  let lastErr;
  // Labelled so an unsupported field can skip the right amount: a rejected
  // imageSize retries the same aspect, a rejected aspect moves to the next one,
  // and anything else moves on to the next model.
  models: for (const model of GEMINI_IMAGE_MODELS) {
   aspects: for (const aspectRatio of aspects) {
    for (const imageSize of IMAGE_SIZE_ATTEMPTS) {
    const body = bodyFor(aspectRatio, imageSize);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          // Key travels in a header, not the query string, so it stays out of
          // request logs and referrers.
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        const errText = await res.text();
        lastErr = new Error(
          `${model} ${aspectRatio}${imageSize ? `/${imageSize}` : ''} -> ${res.status}: ${errText.slice(0, 200)}`,
        );
        if (res.status === 400) {
          // Retry the same aspect without the size field.
          if (imageSize && /imageSize|image_size/i.test(errText)) continue;
          // An unsupported ratio: try the next one rather than giving up on the model.
          if (/aspect|ratio/i.test(errText)) continue aspects;
        }
        if (res.status === 404 || res.status === 400) continue models;
        throw lastErr;
      }
      const data = await res.json();
      const respParts = data?.candidates?.[0]?.content?.parts || [];
      const imgPart = respParts.find(p => p.inlineData || p.inline_data);
      if (!imgPart) {
        lastErr = new Error(
          `${model} returned no image (finishReason=${data?.candidates?.[0]?.finishReason || 'n/a'})`,
        );
        continue;
      }
      const inline = imgPart.inlineData || imgPart.inline_data;
      return {
        src: `data:${inline.mimeType || inline.mime_type};base64,${inline.data}`,
        model,
        aspectRatio,
        imageSize: imageSize || 'default',
      };
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastErr = err;
      continue models; // a transport failure is not fixed by another ratio
    } finally {
      clearTimeout(timer);
    }
    }
   }
  }
  throw lastErr || new Error('All Gemini image model variants failed');
}

// ── Response shaping ───────────────────────────────────────────────────────

/** Reviewer-facing flags. Mirrors buildFlagsFromSignals on the client. */
function buildFlags(verdict) {
  const flags = [];
  if (verdict.prompt.riskScore > 25) flags.push(`prompt:${verdict.prompt.riskScore}`);
  for (const c of verdict.prompt.categories) flags.push(c);
  if (verdict.prompt.obfuscationDetected) flags.push('obfuscated');
  if (verdict.name.severity === 'review') flags.push('name:review');
  for (const c of verdict.components) {
    if (c.available && c.value > 25) flags.push(`${c.key}:${c.value}`);
  }
  if (verdict.unevaluated.length) flags.push(`unevaluated:${verdict.unevaluated.length}`);
  return flags.length ? [...new Set(flags)] : ['clean'];
}

function publicVerdict(verdict, cfg, extra = {}) {
  return {
    decision: verdict.decision,
    riskScore: verdict.riskScore,
    safetyScore: verdict.safetyScore,
    components: verdict.components,
    unevaluated: verdict.unevaluated,
    coverage: verdict.coverage,
    notes: verdict.notes,
    hardBlocked: verdict.hardBlocked,
    blockedCategories: verdict.blockedCategories,
    promptCategories: verdict.prompt.categories,
    obfuscationDetected: verdict.prompt.obfuscationDetected,
    name: {
      severity: verdict.name.severity,
      normalized: verdict.name.normalized,
      reasons: verdict.name.reasons,
    },
    moderation: {
      provider: cfg.provider,
      configured: cfg.configured,
      available: verdict.moderationAvailable,
      // Category scores are useful in the ops audit trail; the model's free-text
      // reasoning is not returned to the browser.
      scores: verdict.model?.scores ?? null,
      blocked: verdict.model?.blocked ?? [],
      review: verdict.model?.review ?? [],
    },
    enforcedBy: 'server',
    ...extra,
  };
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (rateLimited(clientKey(req))) {
    return res.status(429).json({
      error: 'Too many generation requests. Please wait a minute and try again.',
    });
  }

  let body;
  // `req.body` is a lazy getter on Vercel and throws on a malformed payload, so
  // reading it must be guarded or a client error surfaces as a 500.
  try {
    body = req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Missing request body' });
  }

  // ── Input validation ─────────────────────────────────────────────────────
  const selections = sanitizeSelections(body.selections);
  const orientation = sanitizeOrientation(body.orientation);
  const freeText = String(body.freeText ?? '').slice(0, MAX_FREETEXT);
  const cardholderName = String(body.cardholderName ?? '').slice(0, 64);
  const variations = Math.min(Math.max(parseInt(body.variations, 10) || 1, 1), MAX_VARIATIONS);

  let inputImage = null;
  if (body.inputImage && typeof body.inputImage === 'object') {
    const { mimeType, base64 } = body.inputImage;
    if (typeof base64 !== 'string' || !/^image\/(jpeg|png|webp)$/.test(String(mimeType))) {
      return res.status(400).json({ error: 'Unsupported image payload' });
    }
    // base64 expands by 4/3; check the decoded size.
    if (base64.length * 0.75 > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: 'Uploaded image is too large' });
    }
    inputImage = { mimeType, base64 };
  }

  const hasUpload = !!inputImage;
  const styleText = buildStyleText(selections);
  const cfg = moderationConfig();
  const base = { freeText, styleText, cardholderName, hasUpload };

  // ── Pass A · deterministic blocklists ────────────────────────────────────
  // Free and instant. Refusing here avoids paying for a classifier call on
  // input that is already disqualified.
  const deterministic = evaluateSubmission(base);
  if (!deterministic.allowGeneration) {
    return res.status(422).json({
      ...publicVerdict(deterministic, cfg, { stoppedAt: 'blocklist' }),
      error: deterministic.decision.reason,
      images: [],
    });
  }

  // ── Pass B · model classification of the inputs ──────────────────────────
  const [promptVerdict, nameVerdict, uploadVerdict] = await Promise.all([
    moderateText([styleText, freeText].filter(Boolean).join('. '), cfg),
    cardholderName.trim() ? moderateText(cardholderName, cfg) : Promise.resolve(null),
    inputImage ? moderateImage(inputImage, cfg, 'upload') : Promise.resolve(null),
  ]);

  const inputModel = mergeModelVerdicts([promptVerdict, uploadVerdict].filter(Boolean));
  const preGen = evaluateSubmission({ ...base, model: inputModel, nameModel: nameVerdict });

  if (!preGen.allowGeneration) {
    return res.status(422).json({
      ...publicVerdict(preGen, cfg, { stoppedAt: 'input-moderation' }),
      error: preGen.decision.reason,
      images: [],
    });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(503).json({
      ...publicVerdict(preGen, cfg, { stoppedAt: 'configuration' }),
      error: 'Image generation is not configured on the server (GEMINI_API_KEY missing).',
      images: [],
    });
  }

  // ── Generation, using only redacted text ─────────────────────────────────
  const prompt = hasUpload
    ? buildEditPrompt(selections, preGen.safeFreeText)
    : buildFullPrompt(selections, preGen.safeFreeText);

  const results = await Promise.all(
    Array.from({ length: variations }, () =>
      generateGemini({ prompt, key, inputImage, orientation })
        .then(r => ({ ok: true, src: r.src }))
        .catch(err => ({ ok: false, error: err.message })),
    ),
  );

  const produced = results.filter(r => r.ok).map(r => r.src);
  const errors = results.filter(r => !r.ok).map(r => r.error);

  // ── Pass C · model classification of the OUTPUT ──────────────────────────
  // A clean prompt does not guarantee clean output. Anything the classifier
  // blocks is dropped before it is ever sent to the browser.
  let outputVerdicts = [];
  let images = produced;
  let droppedImages = 0;
  let quality = null;

  if (produced.length && cfg.configured && cfg.moderateOutputImages) {
    // The customer's own words are handed to the classifier so the same call also
    // scores how faithfully each render matches what they asked for.
    const request = [preGen.safeFreeText, styleText].filter(Boolean).join('. ');
    outputVerdicts = await moderateImages(produced, cfg, { request });

    // Keep artwork paired with its verdict while filtering and ranking.
    const kept = produced
      .map((src, i) => ({ src, v: outputVerdicts[i] }))
      // Unavailable (an outage) is not a block — it degrades the decision below
      // instead of discarding artwork we simply failed to inspect.
      .filter(({ v }) => !(v?.available && v.blocked.length > 0));

    droppedImages = produced.length - kept.length;

    // Best match first, so the variation the customer sees selected is the one
    // closest to their description rather than an arbitrary one.
    kept.sort((a, b) => (b.v?.quality?.overall ?? 0) - (a.v?.quality?.overall ?? 0));
    images = kept.map(k => k.src);
    outputVerdicts = kept.map(k => k.v);

    const best = kept[0]?.v;
    if (best?.quality?.available) {
      quality = {
        promptMatch: best.quality.scores.prompt_match,
        visualQuality: best.quality.scores.visual_quality,
        textFree: best.quality.scores.text_free,
        embossSafe: best.quality.scores.emboss_safe,
        overall: best.quality.overall,
        warnings: best.quality.warnings,
        failures: best.quality.failures,
        missing: best.quality.missing,
        embosserReady: best.quality.embosserReady && best.embosser?.meetsEmbosserMinimum !== false,
        // Ranked per variation so the UI can label each thumbnail.
        perVariation: kept.map(k => k.v?.quality?.overall ?? null),
      };
    }
    if (best?.embosser) {
      quality = { ...(quality || {}), resolution: best.embosser };
    }
  } else if (produced.length) {
    // Resolution is measurable without a classifier.
    const fit = assessEmbosserFit(produced[0]);
    if (fit.measured) quality = { resolution: fit };
  }

  const finalModel = mergeModelVerdicts(
    [promptVerdict, uploadVerdict, ...outputVerdicts].filter(Boolean),
  );
  const finalVerdict = evaluateSubmission({
    ...base, model: finalModel, nameModel: nameVerdict,
  });

  // Every generated image failed moderation: nothing safe to show.
  if (produced.length > 0 && images.length === 0 && droppedImages > 0) {
    return res.status(422).json({
      ...publicVerdict(finalVerdict, cfg, { stoppedAt: 'output-moderation', droppedImages }),
      decision: {
        code: 'REJECTED', label: 'Rejected', tone: 'fail', icon: '✕',
        reason: 'The generated artwork did not pass image moderation. Nothing was kept.',
      },
      hardBlocked: true,
      error: 'Generated artwork failed image moderation.',
      images: [],
    });
  }

  // Signed so /api/submissions can trust the verdict without re-running the
  // classifier, and so a tampered client cannot submit rejected artwork as
  // approved. Only minted on a successful, allowed generation.
  const verdictToken = signVerdict({
    decision: finalVerdict.decision.code,
    decisionLabel: finalVerdict.decision.label,
    decisionObject: finalVerdict.decision,
    riskScore: finalVerdict.riskScore,
    safetyScore: finalVerdict.safetyScore,
    hardBlocked: finalVerdict.hardBlocked,
    confidence: Math.round(
      Math.min(100, Math.abs(50 - finalVerdict.riskScore) * 2) * (finalVerdict.coverage / 100),
    ),
    flags: buildFlags(finalVerdict),
    quality,
    moderation: {
      provider: cfg.provider,
      available: finalVerdict.moderationAvailable,
      blocked: finalModel.blocked,
      review: finalModel.review,
    },
    signals: {
      promptRisk: finalVerdict.prompt.riskScore,
      promptFlags: finalVerdict.prompt.categories,
      nameSeverity: finalVerdict.name.severity,
      detectors: Object.fromEntries(
        finalVerdict.components
          .filter(c => ['nsfw', 'celebrity', 'logo', 'ocrText', 'imageQuality'].includes(c.key))
          .map(c => [c.key, { available: c.available, value: c.value }]),
      ),
      riskScore: finalVerdict.riskScore,
      safetyScore: finalVerdict.safetyScore,
      coverage: finalVerdict.coverage,
      unevaluated: finalVerdict.unevaluated,
      enforcedBy: 'server',
      fraudEvaluated: false,
      quality,
    },
  });

  return res.status(200).json({
    ...publicVerdict(finalVerdict, cfg, { droppedImages }),
    images,
    verdictToken,
    // Prompt fidelity + print readiness for the selected variation.
    quality,
    requested: variations,
    // The prompt actually sent, post-redaction — useful for the ops audit trail
    // and safe to expose because every blocklist hit has been removed.
    prompt,
    redactions: finalVerdict.redaction.redactions.map(r => ({ category: r.category, kind: r.kind })),
    errors: errors.length ? errors : undefined,
  });
}
