import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { LAYER_DEFS } from '../../lib/pipeline.js';

const STATUS_LABEL = {
  pending: 'Pending',
  running: 'Running',
  pass:    'Passed',
  warn:    'Flagged',
  fail:    'Blocked',
};

// Map technical layer ids → customer-friendly check labels
const FRIENDLY_CHECKS = [
  { ids: ['L1'],        label: 'Photo quality',         icon: '📷' },
  { ids: ['L0', 'L2'],  label: 'Content is appropriate', icon: '✨' },
  { ids: ['L3', 'L4'],  label: 'Design approval',       icon: '✅' },
  { ids: ['L5', 'L6'],  label: 'Final safety check',    icon: '🛡️' },
];

function aggregateStatus(layerStatus, ids) {
  const states = ids.map((id) => layerStatus[id] || 'pending');
  if (states.some((s) => s === 'fail')) return 'fail';
  if (states.some((s) => s === 'warn')) return 'warn';
  if (states.some((s) => s === 'running') || states.some((s) => s === 'pending')) {
    return states.every((s) => s === 'pending') ? 'pending' : 'running';
  }
  return 'pass';
}

export default function StepReview() {
  const { layerStatus } = useApp();
  const [techOpen, setTechOpen] = useState(false);

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
                {status === 'pass' ? '✓' : status === 'fail' ? '✕' : status === 'warn' ? '!' : c.icon}
              </span>
              <span className="fcheck-label">{c.label}</span>
              <span className="fcheck-status">
                {status === 'pass' ? 'Done' : status === 'running' ? 'Checking…' : status === 'warn' ? 'Review' : status === 'fail' ? 'Issue' : 'Waiting'}
              </span>
            </div>
          );
        })}
      </div>

      <details className="review-tech" open={techOpen} onToggle={(e) => setTechOpen(e.target.open)}>
        <summary>Technical details</summary>
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
