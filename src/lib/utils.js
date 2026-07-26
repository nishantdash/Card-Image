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







export const COHORT_APPROVAL = {
  'cyberpunk':       87,
  'watercolor':      95,
  'anime':           82,
  'minimal':         96,
  'oil-painting':    91,
  'vintage-poster':  88,
  '3d-render':       85,
};
