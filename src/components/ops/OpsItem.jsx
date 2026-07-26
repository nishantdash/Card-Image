import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { riskTone, COHORT_APPROVAL } from '../../lib/utils.js';
import { decideSubmission } from '../../lib/opsApi.js';

const PRESET_REASONS = [
  'Image quality below embosser threshold',
  'Image contains prohibited or unsafe content',
  'Image resembles a celebrity / public figure',
  'Image contains a brand logo or trademark',
  'Text in image is illegible or non-compliant',
];

const NOT_EVALUATED = 'Not evaluated';

// A detector that never ran is shown as such. The previous version defaulted
// every missing signal to `?? 0` and rendered it green, so a reviewer could not
// distinguish "measured clean" from "never measured" — which is precisely the
// judgement a human reviewer is here to make.
function detectorRow(name, signals, key) {
  const d = signals.detectors?.[key];
  if (!d || !d.available) return { name, val: NOT_EVALUATED, tone: 'unknown' };
  return {
    name,
    val: `${d.value}/100`,
    tone: d.value < 25 ? 'ok' : d.value < 60 ? 'warn' : 'bad',
  };
}

function signalRows(signals, cohortApproval, styleLabel) {
  if (!signals) return [];
  const promptRisk = signals.promptRisk ?? 0;
  const rows = [
    { name: 'Prompt Risk', val: `${promptRisk}/100`,
      tone: promptRisk < 25 ? 'ok' : promptRisk < 60 ? 'warn' : 'bad' },
    { name: 'Cardholder Name',
      val: signals.nameSeverity === 'ok' ? 'Clean'
        : signals.nameSeverity === 'review' ? 'Needs review'
        : signals.nameSeverity === 'block' ? 'Blocked' : NOT_EVALUATED,
      tone: signals.nameSeverity === 'ok' ? 'ok'
        : signals.nameSeverity === 'review' ? 'warn'
        : signals.nameSeverity === 'block' ? 'bad' : 'unknown' },
    detectorRow('NSFW', signals, 'nsfw'),
    detectorRow('Celebrity Match', signals, 'celebrity'),
    detectorRow('Logo / Trademark', signals, 'logo'),
    detectorRow('OCR Text', signals, 'ocrText'),
    detectorRow('Image Quality', signals, 'imageQuality'),
    { name: 'Fraud Checks', val: signals.fraudEvaluated ? 'Clean' : NOT_EVALUATED,
      tone: signals.fraudEvaluated ? 'ok' : 'unknown' },
    { name: 'Model Coverage', val: `${signals.coverage ?? 0}%`,
      tone: (signals.coverage ?? 0) >= 90 ? 'ok' : (signals.coverage ?? 0) >= 60 ? 'warn' : 'bad' },
    { name: 'Enforced By', val: signals.enforcedBy || 'unknown',
      tone: signals.enforcedBy === 'server' ? 'ok' : 'warn' },
    { name: `Cohort Approval (${styleLabel})`, val: cohortApproval + '%',
      tone: cohortApproval >= 90 ? 'ok' : cohortApproval >= 80 ? 'warn' : 'bad' },
  ];
  if (signals.upload) {
    rows.splice(7, 0, {
      name: 'Upload',
      val: `${signals.upload.resolution} · ${signals.upload.dpi} DPI`,
      tone: signals.upload.dpi >= 300 ? 'ok' : 'warn',
    });
  }
  return rows;
}

/**
 * Total generation attempts for a submission, per orientation.
 *
 * Accepts the legacy `regenCount` shape so items persisted from an older session
 * still render. `regenCount` undercounted — it skipped the first generation and
 * never saw orientation re-renders — so it is reported as a total only, with no
 * orientation split to imply.
 */
function normalizeIterations(item) {
  if (item.iterations && typeof item.iterations.total === 'number') return item.iterations;
  if (typeof item.regenCount === 'number') {
    return { total: item.regenCount, horizontal: 0, vertical: 0, legacy: true };
  }
  return null;
}

function RejectModalBody({ item, inputRef, onPresetClick }) {
  return (
    <>
      <div className="modal-card-preview">
        <div
          className={`thumb ${item.imageUrl ? '' : (item.art || '')}`}
          style={item.imageUrl ? { backgroundImage: `url('${item.imageUrl}')` } : undefined}
        ></div>
        <div className="info">
          <div className="name">{item.cardholderName}</div>
          <div className="meta">
            <strong>Risk:</strong> {item.risk}/100 ·{' '}
            <strong>Style:</strong> {item.style || '—'}<br />
            <strong>Flags:</strong> {(item.flags || []).join(', ') || 'none'}
          </div>
        </div>
      </div>
      <p>Provide a clear reason — this is logged for audit and shown to the customer.</p>
      <textarea
        ref={inputRef}
        rows={4}
        placeholder="e.g. Image resembles a copyrighted character. Please choose a different style or upload a different photo."
      />
      <div className="reject-presets">
        {PRESET_REASONS.map((r) => (
          <button key={r} className="preset" onClick={() => onPresetClick(r)}>
            {r.split(' ').slice(0, 2).join(' ')}
          </button>
        ))}
      </div>
    </>
  );
}

export default function OpsItem({ item }) {
  const { openModal, showToast, refreshQueue } = useApp();
  const [sigOpen, setSigOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const tone = riskTone(item.risk);
  const isUserSub = !!item.isUserSubmission;
  const cohortApproval = COHORT_APPROVAL[item.style] ?? 89;
  const orientClass = (item.orientation || 'horizontal') === 'vertical' ? 'vertical' : '';
  // Server-stored submissions carry `thumbnail`; the seeded demo rows use CSS art.
  const artwork = item.thumbnail || item.imageUrl;
  const thumbCardStyle = artwork ? { backgroundImage: `url('${artwork}')` } : undefined;
  const thumbClass = artwork ? '' : (item.art || '');
  const iters = normalizeIterations(item);

  // Decisions are persisted server-side so every reviewer sees the same queue.
  const decide = async (action, reason) => {
    setBusy(true);
    try {
      await decideSubmission({ id: item.id, action, reason });
      await refreshQueue();
      showToast(
        action === 'approve' ? 'ok' : 'fail',
        action === 'approve'
          ? `✓ ${item.cardholderName || item.id} approved · sent to embosser`
          : `✕ ${item.cardholderName || item.id} rejected`,
      );
    } catch (err) {
      showToast('fail', `Could not ${action}: ${err.message}`);
      // Another reviewer may have already decided it — resync either way.
      await refreshQueue();
    } finally {
      setBusy(false);
    }
  };

  const approve = () => decide('approve');

  const reject = () => {
    const ref = { current: null };
    openModal({
      title: 'Reject design',
      subtitle: `${item.cardholderName} · ${item.id}`,
      body: (
        <RejectModalBody
          item={item}
          inputRef={ref}
          onPresetClick={(r) => { if (ref.current) { ref.current.value = r; ref.current.classList.remove('error'); ref.current.focus(); } }}
        />
      ),
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Confirm Rejection',
          variant: 'primary',
          handler: () => {
            const reason = (ref.current?.value || '').trim();
            if (!reason) {
              ref.current?.classList.add('error');
              ref.current?.focus();
              showToast('fail', 'Rejection reason is required');
              return false;
            }
            decide('reject', reason);
          },
        },
      ],
    });
  };

  return (
    <div className={`ops-item ${isUserSub ? 'user-submission' : ''}`} data-id={item.id}>
      <div className={`ops-thumb ${thumbClass} ${orientClass}`}>
        {item.imageUrl && <div className="ops-thumb-card" style={thumbCardStyle}></div>}
        {isUserSub && <span className="submission-badge">Just Submitted</span>}
        {/* A reviewer must be able to tell seeded sample data from a real
            customer submission. */}
        {item.isDemo && <span className="submission-badge demo">Sample data</span>}
      </div>
      <div className="ops-body">
        <div className="ops-meta">
          <span className="name">{item.cardholderName || 'Unnamed cardholder'}</span>
          <span className="sub">
            <span>{item.id}</span><span>·</span><span>{item.time || 'just now'}</span>
          </span>
        </div>

        <div className="ops-scores">
          <div className={`score-card risk ${tone}`}><span className="lbl">Risk</span><span className="val">{item.risk}</span></div>
          <div className="score-card safety"><span className="lbl">Safety</span><span className="val">{item.safety}</span></div>
          <div className="score-card confidence"><span className="lbl">AI Conf</span><span className="val">{item.confidence}%</span></div>
        </div>

        <div className="ops-bar">
          <div className="ops-bar-fill" style={{ width: `${item.risk}%` }}></div>
        </div>

        <div className="ops-cohort">
          <span>Cohort approval ({item.style || 'mixed'})</span>
          <strong>{cohortApproval}%</strong>
        </div>

        {iters && (
          <div className="ops-regen-count">
            <span>Generation attempts</span>
            <strong>
              {iters.total}
              {(iters.horizontal > 0 || iters.vertical > 0) && (
                <span className="iter-split">
                  {' '}({iters.horizontal}H · {iters.vertical}V)
                </span>
              )}
            </strong>
          </div>
        )}

        <button className="ops-signals-toggle" onClick={() => setSigOpen(v => !v)}>
          {sigOpen ? 'Hide signal breakdown ▴' : 'View signal breakdown ▾'}
        </button>
        <div className={`ops-signals-list ${sigOpen ? 'open' : ''}`}>
          {signalRows(item.signals, cohortApproval, item.style || 'mixed').length === 0
            ? <div className="muted small">No signal data</div>
            : signalRows(item.signals, cohortApproval, item.style || 'mixed').map((r, i) => (
                <div key={i} className={`sig-row ${r.tone}`}><span>{r.name}</span><span>{r.val}</span></div>
              ))}
        </div>

        <div className="ops-flags">
          {(item.flags || []).map((f, i) => (
            <span key={i} className={`flag ${tone === 'high' ? 'bad' : tone === 'med' ? 'warn' : ''}`}>{f}</span>
          ))}
        </div>

        <div className="ops-actions">
          <button className="approve" onClick={approve} disabled={busy}>
            {busy ? '…' : '✓ Approve'}
          </button>
          <button className="reject" onClick={reject} disabled={busy}>
            {busy ? '…' : '✕ Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}
