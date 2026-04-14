const LAYERS = [
  {
    n: 'L0',
    title: 'Prompt Intelligence',
    desc: 'Parse, sanitize and risk-score user prompts. Strips celebrities, brands, political and religious references before generation.',
    bullets: ['LLM prompt parser', 'Restricted-keyword sanitizer', 'Abuse detection (3 strikes / session)'],
  },
  {
    n: 'L1',
    title: 'Upload Guardrails',
    desc: 'Validate file integrity, resolution, DPI, blur, noise. Lightweight NSFW pre-screen plus steganography checks.',
    bullets: ['≥ 1713×1080, 600 DPI', 'Laplacian blur detection', 'LSB steganography scan'],
  },
  {
    n: 'L2',
    title: 'Image Analysis',
    desc: 'Multi-model vision: NSFW, faces, celebrity match, logo/trademark, OCR, object detection, CLIP concept similarity.',
    bullets: ['NudeNet, InsightFace, YOLOv8', 'PaddleOCR for text extraction', 'OpenCLIP concept embeddings'],
  },
  {
    n: 'L3',
    title: 'Risk Scoring Engine',
    desc: 'Weighted aggregation of all upstream signals into a unified risk score. Hard blockers override the formula.',
    bullets: ['Weighted multi-signal model', 'Hard-block list (weapons, CSAM, hate)', 'Cohort-aware thresholds'],
  },
  {
    n: 'L4',
    title: 'Smart Auto Approval',
    desc: 'Routes safe submissions straight to embosser delivery. Targets >80% automation.',
    bullets: ['Auto / Quick Review / Manual / Reject', 'Cohort-specific approval rates', 'Time-bounded quick-review SLA'],
  },
  {
    n: 'L5',
    title: 'Fraud Detection',
    desc: 'Behavioral signals + perceptual hashing to catch bypass attempts and abusive accounts.',
    bullets: ['pHash duplicate detection', 'Submission velocity monitoring', 'Per-user risk scoring'],
  },
  {
    n: 'L6',
    title: 'Continuous Learning',
    desc: 'Closes the loop. Ops decisions feed a labeled dataset that retrains weights and detectors over time.',
    bullets: ['Decision feedback collection', 'Risk weight tuning', 'Read-only for first 3–6 months'],
  },
];

export default function ArchitectureView() {
  return (
    <>
      <h1>Six-Layer Moderation Architecture</h1>
      <p className="muted">Every customer submission flows through these layers before delivery to the bank.</p>
      <div className="arch-flow">
        {LAYERS.map((L) => (
          <div key={L.n} className="arch-layer">
            <div className="arch-num">{L.n}</div>
            <h3>{L.title}</h3>
            <p>{L.desc}</p>
            <ul>
              {L.bullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
