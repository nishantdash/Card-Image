import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { LAYER_DEFS } from '../../lib/pipeline.js';

const STATUS_LABEL = {
  pending: 'Pending',
  running: 'Running',
  pass:    'Passed',
  warn:    'Flagged',
  fail:    'Blocked',
  skip:    'Not evaluated',
};

// Customer-friendly groupings over the technical layers.
const FRIENDLY_CHECKS = [
  { ids: ['L0', 'L1'],       label: 'Content is appropriate', icon: '✨' },
  { ids: ['L2', 'L3'],       label: 'Photo & image checks',   icon: '📷' },
  { ids: ['L4', 'L5'],       label: 'Design approval',        icon: '✅' },
  { ids: ['L6', 'L7'],       label: 'Final safety check',     icon: '🛡️' },
];

function aggregateStatus(layerStatus, ids) {
  const states = ids.map(id => layerStatus[id] || 'pending');
  if (states.some(s => s === 'fail')) return 'fail';
  if (states.some(s => s === 'warn')) return 'warn';
  if (states.some(s => s === 'running')) return 'running';
  if (states.some(s => s === 'pending')) {
    return states.every(s => s === 'pending') ? 'pending' : 'running';
  }
  // 'skip' only wins when nothing in the group actually ran.
  if (states.every(s => s === 'skip')) return 'skip';
  return 'pass';
}

const FRIENDLY_STATUS = {
  pass: 'Done',
  running: 'Checking…',
  warn: 'Review',
  fail: 'Issue',
  skip: 'Not checked',
  pending: 'Waiting',
};

export default function StepReview() {
  const { layerStatus } = useApp();
  const [techOpen, setTechOpen] = useState(false);

  const anySkipped = Object.values(layerStatus).some(s => s === 'skip');

  return (
    <div className="review-friendly">
      <div className="review-spinner">
        <div className="spinner big"></div>
      </div>
      <h2>Checking your design…</h2>
      <p className="muted">This usually takes a few seconds. We're making sure your card is ready to print.</p>

      <div className="friendly-checks">
        {FRIENDLY_CHECKS.map((c) => {
          const status = aggregateStatus(layerStatus, c.ids);
          return (
            <div key={c.label} className={`fcheck fcheck-${status}`}>
              <span className="fcheck-icon">
                {status === 'pass' ? '✓'
                  : status === 'fail' ? '✕'
                  : status === 'warn' ? '!'
                  : status === 'skip' ? '–'
                  : c.icon}
              </span>
              <span className="fcheck-label">{c.label}</span>
              <span className="fcheck-status">{FRIENDLY_STATUS[status]}</span>
            </div>
          );
        })}
      </div>

      <details className="review-tech" open={techOpen} onToggle={(e) => setTechOpen(e.target.open)}>
        <summary>Technical details</summary>
        {anySkipped && (
          <p className="muted small">
            Layers marked <strong>Not evaluated</strong> have no detector wired up in this
            build. They are reported as unevaluated rather than passing, and they
            prevent auto-approval.
          </p>
        )}
        <div className="pipeline">
          {LAYER_DEFS.map((L) => {
            const status = layerStatus[L.id] || 'pending';
            return (
              <div key={L.id} className="layer-row" data-status={status} data-layer={L.id}>
                <div className="ln">{L.id}</div>
                <div className="ll">
                  <strong>{L.name}</strong>
                  <span>{L.desc}</span>
                </div>
                <div className="lstatus">{STATUS_LABEL[status] || 'Pending'}</div>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
