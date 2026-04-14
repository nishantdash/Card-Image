import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { riskTone, COHORT_APPROVAL } from '../../lib/utils.js';

const PRESET_REASONS = [
  'Image quality below embosser threshold',
  'Image contains prohibited or unsafe content',
  'Image resembles a celebrity / public figure',
  'Image contains a brand logo or trademark',
  'Text in image is illegible or non-compliant',
];

function signalRows(signals, cohortApproval, styleLabel) {
  if (!signals) return [];
  return [
    { name: 'Prompt Risk',     val: (signals.promptRisk ?? 0) + '/100', tone: (signals.promptRisk ?? 0) < 25 ? 'ok' : (signals.promptRisk ?? 0) < 60 ? 'warn' : 'bad' },
    { name: 'NSFW',            val: (signals.nsfw ?? 0) + '%',          tone: (signals.nsfw ?? 0) < 5 ? 'ok' : 'warn' },
    { name: 'Faces',           val: signals.faces ?? 0,                 tone: 'ok' },
    { name: 'Celebrity Match', val: ((signals.celebrity ?? 0) * 100).toFixed(0) + '%', tone: (signals.celebrity ?? 0) < 0.4 ? 'ok' : (signals.celebrity ?? 0) < 0.7 ? 'warn' : 'bad' },
    { name: 'Logo Detected',   val: signals.logoDetected ? 'Yes' : 'No', tone: signals.logoDetected ? 'bad' : 'ok' },
    { name: 'OCR Text',        val: (signals.textChars ?? 0) + ' chars', tone: (signals.textChars ?? 0) < 10 ? 'ok' : 'warn' },
    { name: 'CLIP Similarity', val: signals.clipSimilarity ?? 0,         tone: (signals.clipSimilarity ?? 0) < 0.3 ? 'ok' : 'warn' },
    { name: 'User Risk',       val: signals.userRisk ?? 0,               tone: (signals.userRisk ?? 0) < 0.2 ? 'ok' : 'warn' },
    { name: `Cohort Approval (${styleLabel})`, val: cohortApproval + '%', tone: cohortApproval >= 90 ? 'ok' : cohortApproval >= 80 ? 'warn' : 'bad' },
  ];
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
  const { setOpsQueue, setOpsHistory, openModal, showToast } = useApp();
  const [sigOpen, setSigOpen] = useState(false);

  const tone = riskTone(item.risk);
  const isUserSub = !!item.isUserSubmission;
  const cohortApproval = COHORT_APPROVAL[item.style] ?? 89;
  const orientClass = (item.orientation || 'horizontal') === 'vertical' ? 'vertical' : '';
  const thumbCardStyle = item.imageUrl ? { backgroundImage: `url('${item.imageUrl}')` } : undefined;
  const thumbClass = item.imageUrl ? '' : (item.art || '');

  const approve = () => {
    setOpsHistory((h) => ({ ...h, approved: [{ ...item, decisionAt: Date.now() }, ...h.approved] }));
    setOpsQueue((q) => q.filter(it => it.id !== item.id));
    showToast('ok', `✓ ${item.cardholderName || item.id} approved · sent to embosser`);
  };

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
            setOpsHistory((h) => ({ ...h, rejected: [{ ...item, decisionAt: Date.now(), reason }, ...h.rejected] }));
            setOpsQueue((q) => q.filter(it => it.id !== item.id));
            showToast('fail', `✕ ${item.cardholderName || item.id} rejected`);
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

        {item.regenCount != null && (
          <div className="ops-regen-count">
            <span>Regeneration attempts</span>
            <strong>{item.regenCount}</strong>
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
          <button className="approve" onClick={approve}>✓ Approve</button>
          <button className="reject" onClick={reject}>✕ Reject</button>
        </div>
      </div>
    </div>
  );
}
