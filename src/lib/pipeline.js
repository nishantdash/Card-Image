import { evaluateSubmission } from '../../shared/guardrails/index.js';
import { buildStyleText, buildPreviewPrompt } from '../../shared/prompt.js';
import { measureUpload } from './imageChecks.js';

// Moderation pipeline.
//
// Two important changes from the original:
//
//  * A layer now reports what it actually did. Layers that depend on detectors
//    nobody has wired up report 'skip' ("Not evaluated") instead of 'pass'.
//    The old version returned hardcoded values and Math.random() scores that
//    always landed under every threshold, so the display said "Passed" for
//    checks that had never run.
//
//  * The verdict this produces on the client is advisory — it exists to give the
//    customer instant feedback. The binding decision comes from /api/generate.
//    See src/lib/providers.js.

export const LAYER_DEFS = [
  { id: 'L0', name: 'Prompt Intelligence', desc: 'Parse, redact and risk-score the design prompt' },
  { id: 'L1', name: 'Cardholder Name',     desc: 'Profanity, charset and embosser-safety checks' },
  { id: 'L2', name: 'Upload Guardrails',   desc: 'Real resolution, DPI and sharpness measurement' },
  { id: 'L3', name: 'Image Analysis',      desc: 'Model moderation of the photo and generated artwork' },
  { id: 'L4', name: 'Risk Scoring Engine', desc: 'Weighted aggregation over evaluated signals' },
  { id: 'L5', name: 'Auto Approval',       desc: 'Server-enforced routing decision' },
  { id: 'L6', name: 'Fraud Detection',     desc: 'Behavioural & perceptual-hash checks' },
  { id: 'L7', name: 'Continuous Learning', desc: 'Decision feedback loop for detector retraining' },
];

export const LAYER_IDS = LAYER_DEFS.map(l => l.id);

export function initialLayerStatus() {
  return Object.fromEntries(LAYER_IDS.map(id => [id, 'pending']));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Client-side preflight: L0–L3.
 *
 * Gives the customer immediate feedback and lets an obviously-blocked submission
 * be stopped before a network round trip. Never authoritative.
 */
export async function runPreflight({
  source, uploaded, freeText, cardholderName, selections, orientation, onStatus,
  shouldStop = () => false,
}) {
  const set = (id, status) => onStatus?.(id, status);
  const signals = {};
  // Returned when the customer cancels mid-flight so the caller can bail without
  // treating a partial pass as a verdict.
  const stopped = () => ({ stopped: true, signals, verdict: null, blocked: false });

  // ── L0 · Prompt ──────────────────────────────────────────────────────────
  set('L0', 'running');
  await sleep(300);
  if (shouldStop()) return stopped();
  const styleText = buildStyleText(selections);

  // ── L2 · Upload measurement (needed before scoring) ──────────────────────
  const hasUpload = source === 'upload' && !!uploaded;
  let upload = null;
  if (hasUpload) {
    upload = await measureUpload(uploaded, orientation);
  }

  // Image detectors are genuinely not wired up. Report them as unavailable and
  // let the scoring engine refuse to auto-approve on their behalf.
  const detectors = {
    nsfw:      { available: false, value: null },
    celebrity: { available: false, value: null },
    logo:      { available: false, value: null },
    ocrText:   { available: false, value: null },
  };
  if (upload?.available) {
    detectors.imageQuality = { available: true, value: upload.qualityRisk };
  }

  const verdict = evaluateSubmission({
    freeText,
    styleText,
    cardholderName,
    hasUpload,
    detectors,
  });

  signals.promptRisk = verdict.prompt.riskScore;
  signals.promptFlags = verdict.prompt.categories;
  signals.promptBlocked = verdict.prompt.blockedCategories;
  signals.obfuscationDetected = verdict.prompt.obfuscationDetected;
  signals.previewPrompt = buildPreviewPrompt(selections, verdict.safeFreeText);
  signals.sanitizedPrompt = verdict.safeFreeText;
  signals.redactions = verdict.redaction.redactions.length;

  set('L0',
    verdict.prompt.hardBlocked ? 'fail' :
    verdict.prompt.categories.length ? 'warn' : 'pass');

  // ── L1 · Cardholder name ─────────────────────────────────────────────────
  set('L1', 'running');
  await sleep(250);
  if (shouldStop()) return stopped();
  signals.nameSeverity = verdict.name.severity;
  signals.nameNormalized = verdict.name.normalized;
  signals.nameRisk = verdict.name.riskScore;
  signals.nameReasons = verdict.name.reasons;
  signals.nameEmpty = verdict.name.empty;
  set('L1',
    verdict.name.severity === 'block' ? 'fail' :
    verdict.name.severity === 'review' ? 'warn' : 'pass');

  // ── L2 · Upload guardrails ───────────────────────────────────────────────
  set('L2', 'running');
  await sleep(250);
  if (shouldStop()) return stopped();
  if (!hasUpload) {
    signals.upload = null;
    set('L2', 'skip');
  } else {
    signals.upload = upload;
    signals.resolution = upload.resolution;
    signals.dpi = upload.dpi;
    signals.sharpness = upload.sharpness;
    signals.fileOK = upload.fileOK;
    set('L2', !upload.fileOK ? 'fail' : upload.issues.length ? 'warn' : 'pass');
  }

  // ── L3 · Image analysis ──────────────────────────────────────────────────
  set('L3', 'running');
  await sleep(300);
  if (shouldStop()) return stopped();
  signals.detectors = detectors;
  signals.unevaluatedDetectors = Object.entries(detectors)
    .filter(([, d]) => !d.available)
    .map(([k]) => k);
  // The browser holds no moderation credential, so nothing has classified the
  // imagery yet. finalizeLayers revises this once the server reports back.
  set('L3', signals.unevaluatedDetectors.length ? 'skip' : 'pass');

  return {
    signals,
    verdict,
    blocked: !verdict.allowGeneration,
    hasUpload,
    detectors,
    stopped: false,
  };
}

/**
 * Fold the server's authoritative verdict into the layer display: L4–L7.
 *
 * `server` may be null when the request never reached the server (client
 * preflight already hard-blocked), in which case the client verdict is shown and
 * labelled as such.
 */
export async function finalizeLayers({
  server, clientVerdict, signals, onStatus, shouldStop = () => false,
}) {
  const set = (id, status) => onStatus?.(id, status);
  const authoritative = server ?? clientVerdict;

  // ── Revise L0 / L3 with the server's model verdict ───────────────────────
  // The client could only run the deterministic blocklists; the server also ran
  // a moderation classifier over the prompt, the uploaded photo and the
  // generated artwork. Those layers now report the real outcome.
  const moderation = server?.moderation;
  signals.moderation = moderation ?? { available: false, configured: false, provider: 'none' };

  if (moderation?.available) {
    signals.detectors = authoritative.components
      ? Object.fromEntries(
          authoritative.components
            .filter(c => ['nsfw', 'celebrity', 'logo', 'ocrText', 'imageQuality'].includes(c.key))
            .map(c => [c.key, { available: c.available, value: c.value }]),
        )
      : signals.detectors;
    signals.modelScores = moderation.scores;
    signals.modelBlocked = moderation.blocked;
    signals.modelReview = moderation.review;
    signals.droppedImages = server.droppedImages ?? 0;

    set('L3',
      moderation.blocked?.length ? 'fail'
        : moderation.review?.length ? 'warn' : 'pass');

    // The prompt layer's verdict also improves once the classifier has seen it.
    if (server.promptCategories?.length || moderation.blocked?.length) {
      set('L0', moderation.blocked?.length || server.hardBlocked ? 'fail' : 'warn');
    }
  } else if (server) {
    // Server responded but moderation was unavailable — keep it unevaluated.
    set('L3', 'skip');
  }

  // ── L4 · Risk scoring ────────────────────────────────────────────────────
  set('L4', 'running');
  await sleep(250);
  if (shouldStop()) return { signals, decision: null, stopped: true };
  signals.riskScore = authoritative.riskScore;
  signals.safetyScore = authoritative.safetyScore;
  signals.components = authoritative.components;
  signals.coverage = authoritative.coverage;
  signals.unevaluated = authoritative.unevaluated;
  signals.notes = authoritative.notes;
  signals.enforcedBy = server ? 'server' : 'client (blocked before dispatch)';
  set('L4',
    signals.riskScore >= 70 ? 'fail' :
    signals.riskScore >= 20 ? 'warn' : 'pass');

  // ── L5 · Routing ─────────────────────────────────────────────────────────
  set('L5', 'running');
  await sleep(200);
  const decision = authoritative.decision;
  set('L5', decision.tone);

  // ── L6 · Fraud detection ─────────────────────────────────────────────────
  set('L6', 'running');
  await sleep(200);
  // Not implemented. Previously reported userRisk: 0.08 and duplicate: false as
  // constants, which read as a passing check.
  signals.fraudEvaluated = false;
  set('L6', 'skip');

  // ── L7 · Continuous learning ─────────────────────────────────────────────
  set('L7', 'running');
  await sleep(150);
  signals.feedbackLogged = false;
  signals.cohortSignal = decision.code;
  set('L7', 'skip');

  return { signals, decision, stopped: false };
}
