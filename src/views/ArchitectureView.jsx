// Architecture reference.
//
// Each layer carries an implementation status. The previous version described
// detectors that do not exist in this build ("NudeNet, InsightFace, YOLOv8",
// "LSB steganography scan") in the same voice as the parts that do, which made
// the moderation stack read as far more complete than it is.
const STATUS_LABEL = {
  live:    { label: 'Implemented', tone: 'live' },
  partial: { label: 'Partial', tone: 'partial' },
  planned: { label: 'Not implemented', tone: 'planned' },
};

const LAYERS = [
  {
    n: 'L0',
    title: 'Prompt Intelligence',
    status: 'live',
    desc: 'Two independent checks on the design prompt: a deterministic blocklist and a moderation classifier. Neither can overrule a block from the other, and every hit is redacted before the prompt reaches a provider.',
    bullets: [
      'Model classification across 16 harm categories',
      'Blocklist floor: obfuscation-resistant (leetspeak, spacing, accents, plurals)',
      'Catches paraphrase a keyword list cannot — "wearing nothing at all"',
      'Full redaction of every matched term before dispatch',
    ],
  },
  {
    n: 'L1',
    title: 'Cardholder Name',
    status: 'live',
    desc: 'Validates the embossed name: profanity and slurs hard-block, charset is restricted to what an embosser can render, and legitimate names that collide with public figures route to a human.',
    bullets: [
      'Profanity / slur hard block',
      'Embosser charset: A–Z, space, hyphen, apostrophe, period',
      'Structural checks (length, repeats, vowels, edge punctuation)',
    ],
  },
  {
    n: 'L2',
    title: 'Upload Guardrails',
    status: 'live',
    desc: 'Measures the uploaded photo for print suitability. Values are computed from the actual file rather than reported as constants.',
    bullets: [
      'Real pixel dimensions and effective DPI at ID-1 card size',
      'Laplacian-variance sharpness (blur) measurement',
      'Aspect-ratio crop warning',
    ],
  },
  {
    n: 'L3',
    title: 'Image Analysis',
    status: 'live',
    desc: 'A multimodal classifier inspects both the uploaded photo and every generated design. Artwork that fails is discarded server-side and never reaches the browser.',
    bullets: [
      'Uploaded photo classified before generation is attempted',
      'Generated output classified after — a clean prompt can still yield unsafe art',
      'NSFW · celebrity likeness · trademark · text-in-image scored 0–100',
      'Fails closed: an outage routes to human review, never to auto-approve',
    ],
  },
  {
    n: 'L4',
    title: 'Risk Scoring Engine',
    status: 'live',
    desc: 'Aggregates signals into a 0–100 score, renormalizing weights over the signals actually available. Hard blocks and per-detector ceilings bypass the average so one severe signal cannot be diluted.',
    bullets: [
      'Weights renormalized over evaluated components',
      'Hard-block override (profanity, slurs, weapons, adult/illegal)',
      'Per-detector ceilings independent of the weighted score',
    ],
  },
  {
    n: 'L5',
    title: 'Auto Approval',
    status: 'live',
    desc: 'Routes to Auto Approve / Quick Review / Manual Review / Rejected. Enforced server-side in /api/generate; the browser cannot promote its own verdict.',
    bullets: [
      'Thresholds: <20 auto · <45 quick · <70 manual · ≥70 reject',
      'Unevaluated detectors cap the outcome below auto-approval',
      'Rejection happens before any provider call is made',
    ],
  },
  {
    n: 'L6',
    title: 'Fraud Detection',
    status: 'planned',
    desc: 'Behavioural and perceptual-hash checks. Not implemented — previously reported a constant userRisk of 0.08 and duplicate:false, which read as a passing check.',
    bullets: [
      'Needs: pHash duplicate detection, submission velocity, per-user risk',
      'Requires durable storage; the current rate limit is per-instance only',
    ],
  },
  {
    n: 'L7',
    title: 'Continuous Learning',
    status: 'planned',
    desc: 'Ops decisions would feed a labelled dataset for retraining weights and detectors. No persistence exists yet, so nothing is collected.',
    bullets: [
      'Needs: decision feedback store, risk-weight tuning',
      'Read-only for the first 3–6 months by design',
    ],
  },
];

export default function ArchitectureView() {
  const live = LAYERS.filter(l => l.status === 'live').length;

  return (
    <>
      <h1>Moderation Architecture</h1>
      <p className="muted">
        Every customer submission flows through these layers before delivery to the
        bank. {live} of {LAYERS.length} are implemented in this build; the rest
        report as unevaluated and hold submissions back from auto-approval.
      </p>
      <div className="arch-flow">
        {LAYERS.map((L) => {
          const s = STATUS_LABEL[L.status];
          return (
            <div key={L.n} className={`arch-layer arch-${s.tone}`}>
              <div className="arch-num">{L.n}</div>
              <div className={`arch-status ${s.tone}`}>{s.label}</div>
              <h3>{L.title}</h3>
              <p>{L.desc}</p>
              <ul>
                {L.bullets.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}
