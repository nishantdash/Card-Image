import { useApp } from '../../context/AppContext.jsx';
import { useGeneration } from '../../lib/useGeneration.js';
import { generateCustomerId, computeConfidence, buildFlagsFromSignals } from '../../lib/utils.js';

export default function StepResult() {
  const {
    signals, decision, variations, selectedVariation, setSelectedVariation,
    cardOrientation, cardholderName, selections, regenCount, setVariations,
    openModal, closeModal, showToast, resetCustomer, setOpsQueue,
  } = useApp();
  const { generate, ensureOrientation } = useGeneration();

  if (!signals || !decision) return null;

  const pickVariation = async (i) => {
    setSelectedVariation(i);
    await ensureOrientation(variations, i, cardOrientation, setVariations);
  };

  const onRegen = async () => {
    await generate();
  };

  const submitToOps = (selected, name) => {
    const id = generateCustomerId();
    const { style, mood, color, background } = selections;
    const risk = signals?.riskScore ?? 0;
    const orient = cardOrientation || 'horizontal';
    const imageUrl = selected.cache?.[orient] || selected.src;
    const artClass = [style && `art-${style}`, mood && `mood-${mood}`].filter(Boolean).join(' ');
    const submission = {
      id,
      cardholderName: name,
      time: 'just now',
      risk,
      safety: signals?.safetyScore ?? (100 - risk),
      confidence: computeConfidence(risk),
      style, mood, color, background,
      flags: buildFlagsFromSignals(signals),
      signals: { ...signals },
      imageUrl,
      art: artClass,
      orientation: orient,
      regenCount,
      decision,
      isUserSubmission: true,
    };
    setOpsQueue((cur) => [submission, ...cur]);
    showToast('ok', `Submitted for review · Tracking ID: ${id}`);
    resetCustomer();
  };

  const onSubmit = () => {
    const selected = variations?.[selectedVariation];
    if (!selected || !selected.src) { showToast('fail', 'No variation selected'); return; }
    if (decision?.code === 'REJECTED') {
      showToast('fail', 'This design was blocked by AI moderation and cannot be submitted');
      return;
    }
    const name = (cardholderName || '').trim().toUpperCase();
    if (!name) {
      showToast('fail', 'Please enter the cardholder name first');
      return;
    }
    const { style, mood, color, background } = selections;
    const styleStr = [style, mood, color, background].filter(Boolean).join(' · ');

    openModal({
      title: 'Submit design for approval?',
      subtitle: 'Once submitted, the design enters the bank ops review queue.',
      body: (
        <>
          <div className="modal-card-preview">
            <div className="thumb" style={{ backgroundImage: `url('${selected.src}')` }}></div>
            <div className="info">
              <div className="name">{name}</div>
              <div className="meta">
                <strong>Style:</strong> {styleStr || '—'}<br />
                <strong>Risk Score:</strong> {signals?.riskScore ?? '—'}/100<br />
                <strong>Decision:</strong> {decision?.label ?? '—'}
              </div>
            </div>
          </div>
          <p>You can still cancel below. After submission, the design will appear in the Ops Dashboard for human review.</p>
        </>
      ),
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Confirm & Submit',
          variant: 'primary',
          handler: () => submitToOps(selected, name),
        },
      ],
    });
  };

  const submitDisabled = decision?.code === 'REJECTED';
  const submitLabel = submitDisabled ? '✕ Submission blocked' : 'Submit for Approval →';
  const submitHint = submitDisabled
    ? 'This design was hard-blocked by AI moderation and cannot be submitted to ops.'
    : `Will be routed as: ${decision.label}. Selected variation #${selectedVariation + 1} will be sent.`;

  const riskScore = signals.riskScore;
  const safetyScore = signals.safetyScore;

  const sigTiles = [
    { name: 'Prompt Risk',  val: signals.promptRisk + '/100', tone: signals.promptRisk < 25 ? 'ok' : signals.promptRisk < 60 ? 'warn' : 'bad' },
    { name: 'NSFW Score',   val: signals.nsfw + '%',          tone: signals.nsfw < 5 ? 'ok' : 'warn' },
    { name: 'Faces',        val: signals.faces,               tone: 'ok' },
    { name: 'Celebrity',    val: (signals.celebrity * 100).toFixed(0) + '%', tone: signals.celebrity < 0.4 ? 'ok' : signals.celebrity < 0.7 ? 'warn' : 'bad' },
    { name: 'Logos',        val: signals.logoDetected ? 'Yes' : 'None', tone: signals.logoDetected ? 'bad' : 'ok' },
    { name: 'OCR Text',     val: signals.textChars + ' chars', tone: 'ok' },
    { name: 'CLIP Sim',     val: signals.clipSimilarity,       tone: signals.clipSimilarity < 0.3 ? 'ok' : 'warn' },
    { name: 'User Risk',    val: signals.userRisk,             tone: 'ok' },
    { name: 'Resolution',   val: signals.resolution,           tone: 'ok' },
  ];

  const verdictTitle =
    decision?.code === 'AUTO_APPROVE'  ? 'Your card is ready!' :
    decision?.code === 'QUICK_REVIEW'  ? 'Almost there' :
    decision?.code === 'MANUAL_REVIEW' ? 'Quick review needed' :
                                         'Design blocked';
  const verdictBody =
    decision?.code === 'AUTO_APPROVE'  ? 'Looking great. Submit when you\'re happy and we\'ll send it to print.' :
    decision?.code === 'QUICK_REVIEW'  ? 'A quick automatic review will clear this in about 2 minutes.' :
    decision?.code === 'MANUAL_REVIEW' ? 'A team member will take a quick look. You\'ll hear back within a day.' :
                                         'This design doesn\'t meet our guidelines. Please try a different look.';

  return (
    <>
      <h2>{verdictTitle}</h2>
      <p className="muted">{verdictBody}</p>

      <div className="result-block">
        <div className="variations-block">
          <div className="variations-head">
            <div>
              <h3>Choose your favourite</h3>
              <p className="muted small">Tap one to preview on your card</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn ghost small" onClick={onRegen}>↻ Try again</button>
              {regenCount > 0 && (
                <span className="regen-counter">
                  {regenCount} retr{regenCount > 1 ? 'ies' : 'y'}
                </span>
              )}
            </div>
          </div>
          <div className="variations-grid">
            {variations.map((v, i) => {
              if (v.failed) {
                return <div key={i} className="variation-thumb failed"><span className="v-num">{i + 1}</span></div>;
              }
              const url = v.cache?.[cardOrientation] || v.src;
              return (
                <div
                  key={i}
                  className={`variation-thumb ${i === selectedVariation ? 'selected' : ''}`}
                  style={{ backgroundImage: `url('${url}')` }}
                  onClick={() => pickVariation(i)}
                >
                  <span className="v-num">{i + 1}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className={`decision-card ${decision.tone === 'pass' ? '' : decision.tone}`}>
          <div className="decision-icon">{decision.icon}</div>
          <div>
            <h3>{decision.label}</h3>
            <p className="muted small">{decision.reason}</p>
          </div>
        </div>

        <details className="result-tech">
          <summary>Technical details</summary>
          <div className="risk-meter">
            <div className="risk-meter-bar">
              <div className="risk-fill" style={{ width: `${riskScore}%` }}></div>
            </div>
            <div className="risk-meter-labels">
              <span>Risk Score: <strong>{riskScore}</strong>/100</span>
              <span>Safety: <strong>{safetyScore}</strong>/100</span>
            </div>
          </div>
          <div className="signal-grid">
            {sigTiles.map((x, i) => (
              <div key={i} className={`signal ${x.tone}`}>
                <div className="signal-name">{x.name}</div>
                <div className="signal-val">{x.val}</div>
              </div>
            ))}
          </div>
        </details>

        <div className="submit-block">
          <button className="btn primary full" onClick={onSubmit} disabled={submitDisabled}>
            {submitDisabled ? '✕ Can\'t submit this design' : 'Submit my design →'}
          </button>
          <p className="muted small center" style={{ color: submitDisabled ? 'var(--red)' : '' }}>
            {submitDisabled ? submitHint : `We'll handle the rest. Selected design #${selectedVariation + 1}.`}
          </p>
        </div>
      </div>
    </>
  );
}
