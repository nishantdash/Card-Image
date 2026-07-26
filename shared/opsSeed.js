// Demo queue seed data.
//
// Seeded into the shared store once, on first read of an empty queue, so the ops
// dashboard is not bare during a walkthrough. Each row is marked `isDemo: true`
// and labelled in the UI — a reviewer must be able to tell sample data from a
// real customer submission.
//
// These represent historical submissions from a deployment where the image
// detectors were wired up, so their detector entries are marked available. Real
// submissions made in this build carry `available: false` for those same
// detectors, and the ops UI renders the difference — a reviewer can tell a
// measured-clean signal from one that was never measured.
//
// Detector values are on a 0–100 scale, matching shared/guardrails/score.js.
// The previous mocks mixed scales (nsfw as 0–4, celebrity as 0–1) with the
// scoring engine's assumptions, which is how the risk ceiling ended up at 32.

const detectors = ({ nsfw, celebrity, logo, ocrText, imageQuality = 8 }) => ({
  nsfw:         { available: true, value: nsfw },
  celebrity:    { available: true, value: celebrity },
  logo:         { available: true, value: logo },
  ocrText:      { available: true, value: ocrText },
  imageQuality: { available: true, value: imageQuality },
});

export const OPS_SEED = [
  {
    isDemo: true,
    id: 'CUST-8492', cardholderName: 'AMIT SHARMA', time: '2m ago',
    risk: 34, safety: 66, confidence: 32,
    style: 'cyberpunk', mood: 'futuristic',
    flags: ['celebrity:42', 'prompt:28'],
    signals: {
      promptRisk: 28, promptFlags: ['celebrities'], nameSeverity: 'ok',
      detectors: detectors({ nsfw: 12, celebrity: 42, logo: 0, ocrText: 0 }),
      riskScore: 34, safetyScore: 66, coverage: 100, unevaluated: [],
      enforcedBy: 'server', fraudEvaluated: false,
    },
    iterations: { total: 3, horizontal: 2, vertical: 1 },
    art: 'art-cyberpunk mood-futuristic',
  },
  {
    isDemo: true,
    id: 'CUST-8488', cardholderName: 'PRIYA NAIR', time: '4m ago',
    risk: 22, safety: 78, confidence: 56,
    style: 'watercolor', mood: 'vibrant',
    flags: ['ocrText:35'],
    signals: {
      promptRisk: 12, promptFlags: [], nameSeverity: 'ok',
      detectors: detectors({ nsfw: 4, celebrity: 5, logo: 0, ocrText: 35 }),
      riskScore: 22, safetyScore: 78, coverage: 100, unevaluated: [],
      enforcedBy: 'server', fraudEvaluated: false,
    },
    iterations: { total: 1, horizontal: 1, vertical: 0 },
    art: 'art-watercolor mood-vibrant',
  },
  {
    isDemo: true,
    id: 'CUST-8485', cardholderName: 'RAHUL VERMA', time: '6m ago',
    risk: 51, safety: 49, confidence: 2,
    style: '3d-render', mood: 'dark',
    flags: ['logo:78', 'brands'],
    signals: {
      promptRisk: 30, promptFlags: ['brands'], nameSeverity: 'ok',
      detectors: detectors({ nsfw: 8, celebrity: 0, logo: 78, ocrText: 10 }),
      riskScore: 51, safetyScore: 49, coverage: 100, unevaluated: [],
      enforcedBy: 'server', fraudEvaluated: false,
    },
    iterations: { total: 6, horizontal: 4, vertical: 2 },
    art: 'art-3d-render mood-dark', warn: true,
  },
  {
    isDemo: true,
    id: 'CUST-8479', cardholderName: 'NEHA GUPTA', time: '8m ago',
    risk: 28, safety: 72, confidence: 44,
    style: 'vintage-poster', mood: 'calm',
    flags: ['ocrText:55'],
    signals: {
      promptRisk: 18, promptFlags: [], nameSeverity: 'ok',
      detectors: detectors({ nsfw: 2, celebrity: 0, logo: 0, ocrText: 55 }),
      riskScore: 28, safetyScore: 72, coverage: 100, unevaluated: [],
      enforcedBy: 'server', fraudEvaluated: false,
    },
    iterations: { total: 2, horizontal: 2, vertical: 0 },
    art: 'art-vintage-poster mood-calm',
  },
  {
    isDemo: true,
    id: 'CUST-8466', cardholderName: 'ARJUN MEHTA', time: '14m ago',
    risk: 67, safety: 33, confidence: 34,
    style: 'oil-painting', mood: 'dark',
    flags: ['celebrity:71', 'political', 'prompt:60'],
    signals: {
      promptRisk: 60, promptFlags: ['celebrities', 'political'], nameSeverity: 'ok',
      detectors: detectors({ nsfw: 3, celebrity: 71, logo: 0, ocrText: 0 }),
      riskScore: 67, safetyScore: 33, coverage: 100, unevaluated: [],
      enforcedBy: 'server', fraudEvaluated: false,
    },
    iterations: { total: 8, horizontal: 5, vertical: 3 },
    art: 'art-oil-painting mood-dark', bad: true,
  },
];
