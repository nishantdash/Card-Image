export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  })[c]);
}

export function formatDecisionTime(ts) {
  if (!ts) return 'just now';
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleString();
}

export function riskTone(risk) {
  if (risk >= 50) return 'high';
  if (risk >= 25) return 'med';
  return 'low';
}

export function generateCustomerId() {
  return 'CUST-' + Math.floor(8000 + Math.random() * 2000);
}

/**
 * Confidence in the routing decision.
 *
 * Distance from the decision boundary is only half the story — a score derived
 * from a model where most detectors never ran is not a confident score, so
 * coverage scales it down.
 */
export function computeConfidence(riskScore, coverage = 100) {
  const distance = Math.min(100, Math.abs(50 - riskScore) * 2);
  return Math.round(distance * (Math.max(0, Math.min(100, coverage)) / 100));
}

export function buildFlagsFromSignals(s) {
  if (!s) return [];
  const flags = [];

  if (s.promptRisk > 25) flags.push(`prompt:${s.promptRisk}`);
  for (const cat of s.promptFlags || []) flags.push(cat);
  if (s.obfuscationDetected) flags.push('obfuscated');

  if (s.nameSeverity === 'block') flags.push('name:blocked');
  else if (s.nameSeverity === 'review') flags.push('name:review');

  for (const [key, d] of Object.entries(s.detectors || {})) {
    if (!d.available) continue;
    if (d.value > 25) flags.push(`${key}:${d.value}`);
  }

  if (s.upload?.issues?.length) flags.push(`quality:${s.upload.issues.length}`);

  // "Not evaluated" is a distinct state from "clean" and reviewers need to see
  // it — the old version emitted 'clean' whenever nothing tripped, including
  // when nothing had actually been checked.
  if (s.unevaluated?.length) flags.push(`unevaluated:${s.unevaluated.length}`);

  if (flags.length === 0) flags.push('clean');
  return flags;
}

export const COHORT_APPROVAL = {
  'cyberpunk':       87,
  'watercolor':      95,
  'anime':           82,
  'minimal':         96,
  'oil-painting':    91,
  'vintage-poster':  88,
  '3d-render':       85,
};
