import { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { useGeneration } from '../../lib/useGeneration.js';
import { validateCardholderName, firstNameError } from '../../../shared/guardrails/index.js';
import { createSubmission, makeThumbnail } from '../../lib/opsApi.js';

const NOT_EVALUATED = 'Not evaluated';

export default function StepResult() {
  const {
    signals, decision, variations, selectedVariation, setSelectedVariation,
    cardOrientation, cardholderName, selections, iterations, setVariations,
    openModal, showToast, resetCustomer, verdictToken, refreshQueue,
  } = useApp();
  const { generate, ensureOrientation } = useGeneration();
  const [submitting, setSubmitting] = useState(false);

  const nameCheck = useMemo(() => validateCardholderName(cardholderName), [cardholderName]);

  if (!signals || !decision) return null;

  const blocked = decision.code === 'REJECTED';
  const hasArtwork = variations.length > 0;

  const pickVariation = async (i) => {
    setSelectedVariation(i);
    await ensureOrientation(variations, i, cardOrientation, setVariations);
  };

  // Submits to the shared server queue. Risk score, decision and signals are NOT
  // sent — the server reads them from the signed verdict token, so a tampered
  // client cannot post rejected artwork as approved.
  const submitToOps = async (selected, name) => {
    const orient = cardOrientation || 'horizontal';
    const imageUrl = selected.cache?.[orient] || selected.src;
    setSubmitting(true);
    try {
      const thumbnail = await makeThumbnail(imageUrl);
      const { item } = await createSubmission({
        verdictToken,
        cardholderName: name,
        selections,
        orientation: orient,
        iterations,
        thumbnail,
      });
      await refreshQueue();
      showToast('ok', `Submitted for review · Tracking ID: ${item.id}`);
      resetCustomer();
    } catch (err) {
      showToast('fail', `Could not submit: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = () => {
    if (blocked) {
      showToast('fail', 'This design was blocked by moderation and cannot be submitted');
      return;
    }
    const selected = variations?.[selectedVariation];
    if (!selected || !selected.src) { showToast('fail', 'No variation selected'); return; }

    // Without a signed verdict the server will refuse, so say so here rather than
    // letting the customer fill in a modal for nothing. Happens when the artwork
    // is offline fallback art (no successful server generation).
    if (!verdictToken) {
      showToast('fail', 'This design was not verified by the server — please try generating again.');
      return;
    }

    // Re-validate at the point of submission: the name field stays editable
    // after the review ran, so the checked value and the submitted value are not
    // guaranteed to be the same.
    if (nameCheck.empty || nameCheck.severity === 'block') {
      showToast('fail', firstNameError(nameCheck) || 'Please check the name on the card');
      return;
    }
    const name = nameCheck.normalized;

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
        { label: 'Confirm & Submit', variant: 'primary', handler: () => submitToOps(selected, name) },
      ],
    });
  };

  const riskScore = signals.riskScore;
  const safetyScore = signals.safetyScore;
  const q = signals.quality;

  // Signal tiles now distinguish "measured clean" from "never measured". The old
  // grid printed fabricated values (a random NSFW score, a hardcoded resolution)
  // that always read as passing.
  const detectorTile = (name, key) => {
    const d = signals.detectors?.[key];
    if (!d?.available) return { name, val: NOT_EVALUATED, tone: 'unknown' };
    return { name, val: `${d.value}`, tone: d.value < 25 ? 'ok' : d.value < 60 ? 'warn' : 'bad' };
  };

  const sigTiles = [
    { name: 'Prompt Risk', val: `${signals.promptRisk}/100`,
      tone: signals.promptRisk < 25 ? 'ok' : signals.promptRisk < 60 ? 'warn' : 'bad' },
    { name: 'Name Check', val: signals.nameSeverity === 'ok' ? 'Clean'
        : signals.nameSeverity === 'review' ? 'Needs review' : 'Blocked',
      tone: signals.nameSeverity === 'ok' ? 'ok' : signals.nameSeverity === 'review' ? 'warn' : 'bad' },
    detectorTile('NSFW', 'nsfw'),
    detectorTile('Celebrity', 'celebrity'),
    detectorTile('Logos', 'logo'),
    detectorTile('OCR Text', 'ocrText'),
    signals.upload
      ? { name: 'Resolution', val: `${signals.upload.resolution} · ${signals.upload.dpi} DPI`,
          tone: signals.upload.dpi >= 300 ? 'ok' : 'warn' }
      : { name: 'Resolution', val: 'No upload', tone: 'unknown' },
    signals.upload
      ? { name: 'Sharpness', val: signals.upload.sharpness == null ? NOT_EVALUATED : `${signals.upload.sharpness}`,
          tone: signals.upload.sharpness == null ? 'unknown' : signals.upload.sharpness > 120 ? 'ok' : 'warn' }
      : { name: 'Sharpness', val: 'No upload', tone: 'unknown' },
    { name: 'Fraud Checks', val: signals.fraudEvaluated ? 'Clean' : NOT_EVALUATED, tone: 'unknown' },
    q?.promptMatch != null
      ? { name: 'Prompt Match', val: `${q.promptMatch}%`,
          tone: q.promptMatch >= 60 ? 'ok' : q.promptMatch >= 35 ? 'warn' : 'bad' }
      : { name: 'Prompt Match', val: NOT_EVALUATED, tone: 'unknown' },
    q?.resolution?.measured
      ? { name: 'Output Size', val: `${q.resolution.resolution} · ${q.resolution.effectiveDpi} DPI`,
          tone: q.resolution.meetsEmbosserMinimum ? 'ok' : 'warn' }
      : { name: 'Output Size', val: NOT_EVALUATED, tone: 'unknown' },
    q?.visualQuality != null
      ? { name: 'Print Quality', val: `${q.visualQuality}%`,
          tone: q.visualQuality >= 60 ? 'ok' : 'warn' }
      : { name: 'Print Quality', val: NOT_EVALUATED, tone: 'unknown' },
  ];

  const verdictTitle =
    decision.code === 'AUTO_APPROVE'  ? 'Your card is ready!' :
    decision.code === 'QUICK_REVIEW'  ? 'Almost there' :
    decision.code === 'MANUAL_REVIEW' ? 'Quick review needed' :
                                        'Design blocked';
  const verdictBody =
    decision.code === 'AUTO_APPROVE'  ? "Looking great. Submit when you're happy and we'll send it to print." :
    decision.code === 'QUICK_REVIEW'  ? 'A quick automatic review will clear this shortly.' :
    decision.code === 'MANUAL_REVIEW' ? "A team member will take a quick look. You'll hear back within a day." :
                                        "This design doesn't meet our guidelines. Please go back and try a different look.";

  return (
    <>
      <h2>{verdictTitle}</h2>
      <p className="muted">{verdictBody}</p>

      <div className="result-block">
        {/* A blocked submission produces no artwork at all — showing placeholder
            art here would present a compliance block as a finished design. */}
        {hasArtwork ? (
          <div className="variations-block">
            <div className="variations-head">
              <div>
                <h3>Choose your favourite</h3>
                <p className="muted small">Tap one to preview on your card</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="btn ghost small" onClick={() => generate()}>↻ Try again</button>
                {iterations.total > 1 && (
                  <span className="regen-counter">
                    {iterations.total} attempts
                  </span>
                )}
              </div>
            </div>
            <div className="variations-grid">
              {variations.map((v, i) => {
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
        ) : (
          <div className="variations-block blocked-note">
            <h3>No artwork was generated</h3>
            <p className="muted small">
              {blocked
                ? 'The request was stopped before it reached the image service, so nothing was created.'
                : 'The image service did not return a design. Please try again.'}
            </p>
          </div>
        )}

        {/* Prompt fidelity, in the customer's language. A render that drifted
            from what they described is the most common reason to try again, and
            previously nothing told them. */}
        {hasArtwork && q?.promptMatch != null && (
          <div className={`fidelity-card ${q.promptMatch >= 60 ? 'ok' : q.promptMatch >= 35 ? 'warn' : 'bad'}`}>
            <div className="fidelity-head">
              <span className="fidelity-label">Match to your description</span>
              <strong className="fidelity-score">{q.promptMatch}%</strong>
            </div>
            <div className="fidelity-bar">
              <div className="fidelity-fill" style={{ width: `${q.promptMatch}%` }}></div>
            </div>
            <p className="muted small">
              {q.promptMatch >= 75
                ? 'This closely matches what you asked for.'
                : q.promptMatch >= 60
                  ? 'A good match. Try again if you had something more specific in mind.'
                  : q.missing
                    ? `Might be missing: ${q.missing}. Try again, or add more detail to your description.`
                    : 'This may not match your description closely. Try again, or add more detail.'}
            </p>
            {q.embosserReady === false && (
              <p className="muted small" style={{ color: 'var(--amber)' }}>
                ⚠ Print check: {q.resolution?.measured && !q.resolution.meetsEmbosserMinimum
                  ? q.resolution.note
                  : 'this design may need adjustment before printing.'}
              </p>
            )}
          </div>
        )}

        <div className={`decision-card ${decision.tone === 'pass' ? '' : decision.tone}`}>
          <div className="decision-icon">{decision.icon}</div>
          <div>
            <h3>{decision.label}</h3>
            <p className="muted small">{decision.reason}</p>
            {decision.notes?.length > 0 && (
              <ul className="decision-notes">
                {decision.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
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

          <p className="muted small">
            Decision enforced by: <strong>{signals.enforcedBy}</strong> · model coverage:{' '}
            <strong>{signals.coverage ?? 0}%</strong>
            {signals.unevaluated?.length > 0 && ` · unevaluated: ${signals.unevaluated.join(', ')}`}
          </p>
          <p className="muted small">
            Model moderation:{' '}
            {signals.moderation?.available ? (
              <>
                <strong>{signals.moderation.provider}</strong> · prompt, photo and
                generated artwork classified
                {signals.droppedImages > 0 &&
                  ` · ${signals.droppedImages} generated image(s) discarded by image moderation`}
              </>
            ) : signals.moderation?.configured === false ? (
              <strong style={{ color: 'var(--amber)' }}>
                not configured — held for human review
              </strong>
            ) : (
              <strong style={{ color: 'var(--amber)' }}>
                unavailable — held for human review
              </strong>
            )}
          </p>
          {signals.modelBlocked?.length > 0 && (
            <p className="muted small" style={{ color: 'var(--red)' }}>
              Blocked categories: {signals.modelBlocked.join(', ')}
            </p>
          )}

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
          <button
            className="btn primary full"
            onClick={onSubmit}
            disabled={blocked || !hasArtwork || submitting}
          >
            {blocked ? "✕ Can't submit this design"
              : submitting ? 'Submitting…'
              : 'Submit my design →'}
          </button>
          <p className="muted small center" style={{ color: blocked ? 'var(--red)' : '' }}>
            {blocked
              ? 'This design was blocked by moderation and cannot be submitted to ops.'
              : hasArtwork
                ? `We'll handle the rest. Selected design #${selectedVariation + 1}.`
                : 'Nothing to submit yet.'}
          </p>
        </div>
      </div>
    </>
  );
}
