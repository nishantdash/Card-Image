import { sanitizePrompt } from './sanitize.js';

export const LAYER_DEFS = [
  { id: 'L0', name: 'Prompt Intelligence',    desc: 'Parse, sanitize and risk-score prompt' },
  { id: 'L1', name: 'Upload Guardrails',      desc: 'File integrity, resolution & quality checks' },
  { id: 'L2', name: 'Image Analysis',         desc: 'NSFW · faces · logos · OCR · CLIP concepts' },
  { id: 'L3', name: 'Risk Scoring Engine',    desc: 'Weighted aggregation of all signals' },
  { id: 'L4', name: 'Auto Approval',          desc: 'Routing decision based on cohort policy' },
  { id: 'L5', name: 'Fraud Detection',        desc: 'Behavioral & perceptual hash checks' },
  { id: 'L6', name: 'Continuous Learning',    desc: 'Decision feedback loop · retrain detectors over time' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function seedNoise() { return +(Math.random() * 6).toFixed(1); }

// Runs the 6-layer pipeline. `onStatus(id, status)` is called as each
// layer flips from 'pending' → 'running' → pass/warn/fail.
// Returns { signals, decision } at the end.
export async function runPipeline({ source, uploaded, freeText, previewPrompt, onStatus }) {
  const signals = {};
  const promptResult = sanitizePrompt(freeText || previewPrompt || '');

  const run = async (id, delay, work) => {
    onStatus(id, 'running');
    await sleep(delay);
    const status = work();
    onStatus(id, status);
  };

  await run('L0', 700, () => {
    const st = promptResult.riskScore > 60 ? 'fail' : promptResult.riskScore > 25 ? 'warn' : 'pass';
    signals.promptRisk = promptResult.riskScore;
    signals.promptFlags = promptResult.flagsHit;
    signals.sanitizedPrompt = promptResult.sanitized;
    return st;
  });

  await run('L1', 600, () => {
    if (source === 'upload' && !uploaded) return 'fail';
    signals.fileOK = true;
    signals.resolution = '2048×1290';
    signals.dpi = 600;
    return 'pass';
  });

  await run('L2', 1100, () => {
    signals.nsfw = +(Math.random() * 4).toFixed(1);
    signals.faces = uploaded ? 1 : 0;
    signals.celebrity = 0;
    signals.logoDetected = false;
    signals.textChars = 0;
    signals.clipSimilarity = +(0.05 + Math.random() * 0.18).toFixed(2);
    signals.objects = [];
    if (promptResult.riskScore > 60) { signals.celebrity = 0.78; return 'fail'; }
    if (promptResult.riskScore > 25) { signals.celebrity = 0.42; return 'warn'; }
    return 'pass';
  });

  await run('L3', 500, () => {
    const score =
      (signals.nsfw * 0.30) +
      (signals.celebrity * 100 * 0.20) +
      (signals.promptRisk * 0.15) +
      ((signals.logoDetected ? 50 : 0) * 0.10) +
      ((signals.textChars > 10 ? 40 : 0) * 0.10) +
      ((signals.objects.length > 0 ? 30 : 0) * 0.10) +
      (seedNoise() * 0.05);
    signals.riskScore = Math.min(Math.round(score), 100);
    signals.safetyScore = 100 - signals.riskScore;
    return signals.riskScore < 20 ? 'pass' : signals.riskScore < 50 ? 'warn' : 'fail';
  });

  let decision;
  await run('L4', 400, () => {
    const r = signals.riskScore;
    if (r < 20)      decision = { code: 'AUTO_APPROVE',  label: 'Auto Approved', tone: 'pass', icon: '✓', reason: 'Risk score below threshold. Image dispatched to embosser queue.' };
    else if (r < 40) decision = { code: 'QUICK_REVIEW',  label: 'Quick Review',  tone: 'warn', icon: '⏱', reason: 'Borderline signals. Will auto-approve in 2 mins unless ops intervenes.' };
    else if (r < 70) decision = { code: 'MANUAL_REVIEW', label: 'Manual Review', tone: 'warn', icon: '👁', reason: 'Routed to ops dashboard for human approval.' };
    else             decision = { code: 'REJECTED',      label: 'Rejected',      tone: 'fail', icon: '✕', reason: 'Hard-blocked by compliance signals. Customer is shown a friendly message.' };
    return decision.tone;
  });

  await run('L5', 500, () => {
    signals.userRisk = 0.08;
    signals.duplicate = false;
    return 'pass';
  });

  await run('L6', 400, () => {
    signals.feedbackLogged = true;
    signals.modelVersion = 'v2026.04-a';
    signals.cohortSignal = decision?.code || 'PENDING';
    return 'pass';
  });

  return { signals, decision };
}
