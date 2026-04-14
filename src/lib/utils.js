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

export function computeConfidence(riskScore) {
  return Math.round(Math.min(100, Math.abs(50 - riskScore) * 2));
}

export function buildFlagsFromSignals(s) {
  if (!s) return [];
  const flags = [];
  if (s.celebrity > 0.4)     flags.push(`celebrity:${s.celebrity.toFixed(2)}`);
  if (s.logoDetected)        flags.push('logo');
  if (s.textChars > 10)      flags.push(`text:${s.textChars}ch`);
  if (s.clipSimilarity > 0.3) flags.push(`clip:${s.clipSimilarity.toFixed(2)}`);
  if (s.promptRisk > 25)     flags.push(`prompt:${s.promptRisk}`);
  if (flags.length === 0)    flags.push('clean');
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
