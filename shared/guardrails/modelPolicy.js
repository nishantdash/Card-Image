// Policy for model-based moderation verdicts.
//
// A keyword blocklist can only catch phrasings someone thought to write down. It
// misses paraphrase ("a woman with nothing on"), novel slang, other languages,
// and anything descriptive rather than named. A classifier scores intent, so it
// generalises — which is what a stakeholder-facing deployment needs.
//
// The blocklist is kept as a deterministic pre-filter rather than removed: it is
// free, instant, cannot be talked out of a decision, and it still works when the
// moderation API is slow or down. The model is the primary semantic check; the
// blocklist is the floor. Neither can overrule a block from the other.
//
// Scores are 0-100. Thresholds are per-category on purpose: an 80 on
// "trademark_brand" is a legal review, whereas a 10 on "sexual_minors" is an
// immediate stop.

export const MODEL_CATEGORIES = {
  sexual:             { block: 55, review: 25, label: 'Sexual content' },
  // Near-zero tolerance: the one category where a false positive costs far less
  // than a false negative.
  sexual_minors:      { block: 10, review: 5,  label: 'Minors in sexual context' },
  violence:           { block: 65, review: 30, label: 'Violence' },
  gore:               { block: 55, review: 25, label: 'Gore / graphic injury' },
  hate:               { block: 40, review: 20, label: 'Hate speech' },
  harassment:         { block: 60, review: 30, label: 'Harassment' },
  self_harm:          { block: 35, review: 15, label: 'Self-harm' },
  illegal_drugs:      { block: 55, review: 25, label: 'Illegal drugs' },
  weapons:            { block: 55, review: 25, label: 'Weapons' },
  extremism:          { block: 35, review: 15, label: 'Extremism / terrorism' },
  celebrity_likeness: { block: 80, review: 40, label: 'Celebrity likeness' },
  trademark_brand:    { block: 85, review: 40, label: 'Third-party trademark' },
  political:          { block: 85, review: 40, label: 'Political figure / symbol' },
  religious:          { block: 85, review: 40, label: 'Religious figure / symbol' },
  pii:                { block: 70, review: 35, label: 'Personal information' },
  text_in_image:      { block: null, review: 45, label: 'Text rendered in image' },
};

export const MODEL_CATEGORY_KEYS = Object.keys(MODEL_CATEGORIES);

/** JSON schema handed to the model so the verdict is machine-checkable. */
export function buildVerdictSchema() {
  return {
    type: 'object',
    properties: {
      categories: {
        type: 'object',
        properties: Object.fromEntries(
          MODEL_CATEGORY_KEYS.map(k => [k, { type: 'integer' }]),
        ),
        required: MODEL_CATEGORY_KEYS,
      },
      reasoning: { type: 'string' },
    },
    required: ['categories'],
  };
}

function clamp100(n) {
  const v = typeof n === 'number' && !Number.isNaN(n) ? n : 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Turn a raw model verdict into policy outcomes.
 *
 * @param raw  { categories: {[key]: 0-100}, reasoning?: string }
 */
export function applyModelVerdict(raw) {
  const scores = {};
  for (const key of MODEL_CATEGORY_KEYS) {
    scores[key] = clamp100(raw?.categories?.[key]);
  }

  const blocked = [];
  const review = [];
  for (const [key, limits] of Object.entries(MODEL_CATEGORIES)) {
    const score = scores[key];
    if (limits.block != null && score >= limits.block) blocked.push(key);
    else if (limits.review != null && score >= limits.review) review.push(key);
  }

  // Risk is driven by the worst category relative to its own thresholds, not by
  // an average across all 16 — averaging buries a single severe hit, which is
  // the same dilution bug the original scoring engine had.
  let riskScore = 0;
  let worst = null;
  for (const [key, limits] of Object.entries(MODEL_CATEGORIES)) {
    const score = scores[key];
    const threshold = limits.review ?? 50;
    const blockAt = limits.block ?? 100;
    let normalized;
    if (score <= threshold) {
      normalized = threshold > 0 ? (score / threshold) * 50 : 0;
    } else {
      const span = Math.max(1, blockAt - threshold);
      normalized = 50 + Math.min(1, (score - threshold) / span) * 40;
    }
    if (normalized > riskScore) {
      riskScore = normalized;
      worst = { category: key, score };
    }
  }
  if (blocked.length) riskScore = Math.max(riskScore, 95);

  return {
    available: true,
    riskScore: Math.round(riskScore),
    blocked,
    review,
    scores,
    reasoning: typeof raw?.reasoning === 'string' ? raw.reasoning.slice(0, 400) : '',
    worst,
    // Fed into scoreSubmission's detector slots — this is what finally makes the
    // "Image Analysis" layer real rather than permanently unevaluated.
    detectors: {
      nsfw:      { available: true, value: Math.max(scores.sexual, scores.sexual_minors, scores.gore) },
      celebrity: { available: true, value: scores.celebrity_likeness },
      logo:      { available: true, value: scores.trademark_brand },
      ocrText:   { available: true, value: scores.text_in_image },
    },
  };
}

/**
 * Verdict used when the moderation service could not be reached.
 *
 * Fail-closed but not fail-reject: an outage must not approve unmoderated
 * artwork, and must not tell a customer their design violates policy when
 * nothing actually checked it. Unavailable detectors already prevent
 * auto-approval in score.js, so this routes to human review.
 */
export function unavailableModelVerdict(reason) {
  return {
    available: false,
    riskScore: 0,
    blocked: [],
    review: [],
    scores: {},
    reasoning: reason || 'Moderation service unavailable',
    worst: null,
    detectors: {
      nsfw:      { available: false, value: null },
      celebrity: { available: false, value: null },
      logo:      { available: false, value: null },
      ocrText:   { available: false, value: null },
    },
  };
}

function mergeAvailable(verdicts) {
  const scores = {};
  for (const key of MODEL_CATEGORY_KEYS) {
    scores[key] = Math.max(...verdicts.map(v => v.scores[key] ?? 0));
  }
  const merged = applyModelVerdict({ categories: scores });
  merged.reasoning = verdicts.map(v => v.reasoning).filter(Boolean).join(' · ').slice(0, 400);
  return merged;
}

/**
 * Merge several verdicts (prompt + uploaded photo + each generated image).
 * Worst-case wins per category.
 */
export function mergeModelVerdicts(verdicts) {
  const present = verdicts.filter(Boolean);
  if (!present.length) return unavailableModelVerdict('No moderation performed');

  const available = present.filter(v => v.available);
  if (available.length === present.length) return mergeAvailable(available);

  // Any incomplete pass means the merged picture is incomplete. Keep whatever
  // blocks were found — a partial outage must not erase a real detection — but
  // mark the detectors unavailable so nothing auto-approves.
  const base = available.length ? mergeAvailable(available) : unavailableModelVerdict('Moderation incomplete');
  base.available = false;
  base.reasoning = [base.reasoning, 'One or more moderation passes did not complete.']
    .filter(Boolean).join(' ');
  for (const d of Object.values(base.detectors)) {
    d.available = false;
    d.value = null;
  }
  return base;
}
