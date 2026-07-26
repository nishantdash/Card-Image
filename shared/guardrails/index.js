// Shared guardrail core.
//
// Imported by BOTH the browser bundle (for immediate UX feedback) and the
// serverless function in api/ (for the authoritative decision). Keeping one
// implementation is the point: a client-side-only guardrail is a suggestion, and
// two separate implementations drift.
//
// Nothing in here may touch `window`, `document`, `fetch` or `process`. The
// network calls for model-based moderation live in api/_moderation.js; this
// module only interprets their verdicts.

export { CATEGORIES, HARD_BLOCK_CATEGORIES, nameSeverityFor } from './terms.js';
export { fold, deIntersperse, foldVariants } from './normalize.js';
export { scanText, redactText, sanitizePrompt } from './text.js';
export { validateCardholderName, firstNameError, NAME_MAX, NAME_MIN } from './name.js';
export { scoreSubmission, THRESHOLDS } from './score.js';
export {
  MODEL_CATEGORIES, MODEL_CATEGORY_KEYS, applyModelVerdict,
  unavailableModelVerdict, mergeModelVerdicts, buildVerdictSchema,
} from './modelPolicy.js';

import { scanText, redactText } from './text.js';
import { validateCardholderName } from './name.js';
import { scoreSubmission } from './score.js';

const uniq = (xs) => [...new Set(xs)];

/**
 * One-shot evaluation of a complete submission.
 *
 * This is the single decision point. The server calls it before touching an
 * image provider; the client calls it (without model verdicts) to show the
 * customer a fast preliminary verdict.
 *
 * Two independent detectors feed it, and neither can veto the other:
 *   - the deterministic blocklists in terms.js, and
 *   - `model` / `nameModel`, verdicts from a moderation classifier.
 * The stricter outcome always wins.
 *
 * @param input.freeText        customer's free-text design note
 * @param input.styleText       prompt fragment assembled from style selections
 * @param input.cardholderName  raw name field
 * @param input.hasUpload       whether a customer photo is attached
 * @param input.detectors       image-detector results, if wired up
 * @param input.model           moderation verdict for the design (text + imagery)
 * @param input.nameModel       moderation verdict for the cardholder name
 */
export function evaluateSubmission({
  freeText = '',
  styleText = '',
  cardholderName = '',
  hasUpload = false,
  detectors = {},
  model = null,
  nameModel = null,
} = {}) {
  const combined = [styleText, freeText].filter(Boolean).join(' \n ');
  const promptScan = scanText(combined);
  const name = validateCardholderName(cardholderName);
  const redaction = redactText(freeText);

  // ── Fold the model verdict into the prompt signal ────────────────────────
  const prompt = { ...promptScan };
  if (model?.available) {
    prompt.riskScore = Math.max(prompt.riskScore, model.riskScore);
    prompt.blockedCategories = uniq([...prompt.blockedCategories, ...model.blocked]);
    prompt.categories = uniq([...prompt.categories, ...model.blocked, ...model.review]);
    prompt.hardBlocked = prompt.hardBlocked || model.blocked.length > 0;
    prompt.modelReasoning = model.reasoning;
    prompt.modelScores = model.scores;
  }

  // A model block on the name is treated exactly like a blocklist block.
  if (nameModel?.available && nameModel.blocked.length > 0) {
    name.severity = 'block';
    name.ok = false;
    name.riskScore = Math.max(name.riskScore, 95);
    name.reasons = [
      ...name.reasons,
      {
        code: `model:${nameModel.blocked[0]}`,
        message: 'That name can’t be printed on a card. Please enter the name as it appears on your ID.',
        severity: 'block',
      },
    ];
  } else if (nameModel?.available && nameModel.review.length > 0 && name.severity === 'ok') {
    name.severity = 'review';
    name.ok = false;
    name.riskScore = Math.max(name.riskScore, 55);
    name.reasons = [...name.reasons, {
      code: `model:${nameModel.review[0]}`,
      message: 'We’ll need to check this name manually before printing.',
      severity: 'review',
    }];
  }

  // Model detector scores supersede placeholders for the same slots.
  const mergedDetectors = { ...detectors, ...(model?.detectors ?? {}) };

  const scored = scoreSubmission({
    prompt, name, detectors: mergedDetectors, hasUpload,
  });

  // Refuse to forward text that could be detected but not cleaned.
  const unredactable = redaction.residual.length > 0;
  if (unredactable && !scored.hardBlocked) {
    scored.decision = {
      code: 'REJECTED', label: 'Rejected', tone: 'fail', icon: '✕',
      reason: 'Prompt contains obfuscated restricted terms that could not be safely rewritten.',
    };
    scored.riskScore = Math.max(scored.riskScore, 90);
    scored.safetyScore = 100 - scored.riskScore;
    scored.hardBlocked = true;
  }

  return {
    ...scored,
    prompt,
    name,
    redaction,
    model: model ?? null,
    nameModel: nameModel ?? null,
    moderationAvailable: !!model?.available,
    safeFreeText: redaction.text,
    allowGeneration: !scored.hardBlocked,
  };
}
