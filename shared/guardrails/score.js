// L3 risk aggregation + L4 routing.
//
// The previous formula could not reach its own thresholds. Three of its six
// weighted inputs were hardcoded to zero, `nsfw` was generated on a 0–4 scale
// but weighted as though it were 0–100, and `celebrity` peaked at 0.78. The
// arithmetic ceiling was 32 against a REJECTED floor of 70, so REJECTED and
// MANUAL_REVIEW were unreachable and the hard-block UI was dead code.
//
// Two changes fix that:
//   1. Every component is normalized to 0–100 and the weights are renormalized
//      over the components actually available, so absent detectors dilute
//      nothing.
//   2. Hard blocks bypass the weighted score entirely. A weighted average should
//      never be able to average away a slur.

export const THRESHOLDS = { auto: 20, quick: 45, manual: 70 };

const COMPONENTS = [
  { key: 'promptRisk',   label: 'Prompt content',  weight: 0.28 },
  { key: 'nameRisk',     label: 'Cardholder name', weight: 0.22 },
  { key: 'nsfw',         label: 'NSFW imagery',    weight: 0.18 },
  { key: 'celebrity',    label: 'Celebrity match', weight: 0.14 },
  { key: 'logo',         label: 'Logo / trademark', weight: 0.06 },
  { key: 'ocrText',      label: 'Text in image',   weight: 0.06 },
  { key: 'imageQuality', label: 'Image quality',   weight: 0.06 },
];

// Per-signal ceilings, applied independently of the weighted average.
//
// Averaging alone is not safe: with nsfw weighted at 0.18, a detector returning
// 95 contributes only ~17 points and would still auto-approve. A single severe
// signal has to be able to stop a submission on its own — that dilution is the
// same mistake the original formula made.
const DETECTOR_LIMITS = {
  nsfw:      { block: 60, review: 25 },
  celebrity: { block: 75, review: 40 },
  logo:      { block: 85, review: 40 },
  ocrText:   { block: null, review: 50 },
  promptRisk:{ block: null, review: 40 },
  nameRisk:  { block: null, review: 40 },
};

const DECISIONS = {
  AUTO_APPROVE: {
    code: 'AUTO_APPROVE', label: 'Auto Approved', tone: 'pass', icon: '✓',
    reason: 'All checks passed. Artwork dispatched to the embosser queue.',
  },
  QUICK_REVIEW: {
    code: 'QUICK_REVIEW', label: 'Quick Review', tone: 'warn', icon: '⏱',
    reason: 'Borderline or incompletely evaluated. Held for a short automated review.',
  },
  MANUAL_REVIEW: {
    code: 'MANUAL_REVIEW', label: 'Manual Review', tone: 'warn', icon: '👁',
    reason: 'Routed to the ops dashboard for human approval before printing.',
  },
  REJECTED: {
    code: 'REJECTED', label: 'Rejected', tone: 'fail', icon: '✕',
    reason: 'Hard-blocked by compliance policy. Nothing is sent to the embosser.',
  },
};

const ORDER = ['AUTO_APPROVE', 'QUICK_REVIEW', 'MANUAL_REVIEW', 'REJECTED'];

/** Return whichever decision is the more restrictive of the two. */
function atLeast(code, floor) {
  return ORDER.indexOf(code) >= ORDER.indexOf(floor) ? code : floor;
}

function clamp100(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/**
 * Aggregate signals into a risk score and a routing decision.
 *
 * @param input.prompt    result of scanText() on the design prompt
 * @param input.name      result of validateCardholderName()
 * @param input.detectors {[key]: {available: boolean, value: number|null}}
 * @param input.hasUpload whether the customer supplied their own photo
 */
export function scoreSubmission({ prompt, name, detectors = {}, hasUpload = false } = {}) {
  const values = {
    promptRisk: { available: true, value: clamp100(prompt?.riskScore ?? 0) },
    // A name that has not been typed yet is "not evaluated", not "risky" — it
    // must not silently push an otherwise clean design into review.
    nameRisk: name?.empty
      ? { available: false, value: null }
      : { available: true, value: clamp100(name?.riskScore ?? 0) },
    ...detectors,
  };

  const components = COMPONENTS.map(c => {
    const v = values[c.key] || { available: false, value: null };
    return {
      key: c.key,
      label: c.label,
      weight: c.weight,
      available: !!v.available,
      value: v.available ? clamp100(v.value) : null,
    };
  });

  const present = components.filter(c => c.available);
  const totalWeight = present.reduce((s, c) => s + c.weight, 0);
  const weighted = totalWeight > 0
    ? present.reduce((s, c) => s + c.value * c.weight, 0) / totalWeight
    : 0;

  const unevaluated = components.filter(c => !c.available).map(c => c.key);

  // ── Hard block override ──────────────────────────────────────────────────
  const blockedCategories = [
    ...(prompt?.blockedCategories ?? []),
    ...(name?.severity === 'block' ? ['cardholder_name'] : []),
  ];

  // A single detector over its own ceiling blocks regardless of the average.
  const detectorReview = [];
  for (const c of present) {
    const limit = DETECTOR_LIMITS[c.key];
    if (!limit) continue;
    if (limit.block != null && c.value >= limit.block) {
      blockedCategories.push(`${c.key}>=${limit.block}`);
    } else if (limit.review != null && c.value >= limit.review) {
      detectorReview.push(c.key);
    }
  }

  const hardBlocked = blockedCategories.length > 0;

  let riskScore = Math.round(weighted);
  if (hardBlocked) riskScore = Math.max(riskScore, 90);

  // ── Routing ──────────────────────────────────────────────────────────────
  let code =
    riskScore >= THRESHOLDS.manual ? 'REJECTED' :
    riskScore >= THRESHOLDS.quick  ? 'MANUAL_REVIEW' :
    riskScore >= THRESHOLDS.auto   ? 'QUICK_REVIEW' :
                                     'AUTO_APPROVE';

  if (hardBlocked) code = 'REJECTED';

  const notes = [];

  // Nothing auto-approves on the strength of detectors that never ran. This is
  // the honest replacement for the old fabricated `nsfw = Math.random() * 4`,
  // which always landed under every threshold and so always passed.
  if (!hardBlocked && unevaluated.length > 0) {
    code = atLeast(code, 'QUICK_REVIEW');
    notes.push(`${unevaluated.length} detector(s) unavailable: ${unevaluated.join(', ')}.`);

    // A customer photo that no image detector has inspected must be seen by a
    // person — there is no signal at all about what is in it.
    const imageDetectors = ['nsfw', 'celebrity', 'logo', 'ocrText'];
    if (hasUpload && imageDetectors.every(k => unevaluated.includes(k))) {
      code = atLeast(code, 'MANUAL_REVIEW');
      notes.push('Uploaded photo was not machine-inspected; human review required.');
    }
  }

  if (!hardBlocked && detectorReview.length > 0) {
    code = atLeast(code, 'MANUAL_REVIEW');
    notes.push(`Detector(s) above review threshold: ${detectorReview.join(', ')}.`);
  }

  // A review-tier blocklist hit in the prompt is a policy routing decision, not
  // a magnitude. Trademark or celebrity likeness on a printed bank card carries
  // legal exposure, so a human signs off even though the weighted score is low.
  const promptReviewCats = (prompt?.categories ?? []).filter(
    c => !(prompt?.blockedCategories ?? []).includes(c),
  );
  if (!hardBlocked && promptReviewCats.length > 0) {
    code = atLeast(code, 'MANUAL_REVIEW');
    notes.push(`Prompt references restricted material: ${promptReviewCats.join(', ')}.`);
  }

  // Deliberate filter probing is itself disqualifying.
  if (prompt?.obfuscationDetected || name?.scan?.obfuscationDetected) {
    code = atLeast(code, 'MANUAL_REVIEW');
    notes.push('Obfuscated restricted term detected (leetspeak or spaced letters).');
  }

  if (name?.severity === 'review' && !name.empty) {
    code = atLeast(code, 'MANUAL_REVIEW');
    notes.push('Cardholder name needs human confirmation.');
  }

  const decision = { ...DECISIONS[code] };
  if (notes.length) decision.notes = notes;
  if (hardBlocked) {
    decision.reason = `Hard-blocked by compliance policy (${blockedCategories.join(', ')}). Nothing is sent to the embosser.`;
  }

  return {
    riskScore,
    safetyScore: 100 - riskScore,
    decision,
    components,
    unevaluated,
    hardBlocked,
    blockedCategories,
    // Share of the weighted model that was actually evaluated — surfaced in the
    // ops UI so a reviewer knows how much of the score to trust.
    coverage: Math.round(totalWeight * 100),
    notes,
  };
}
