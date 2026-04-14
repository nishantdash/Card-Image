import { useApp } from '../../context/AppContext.jsx';
import { formatDecisionTime } from '../../lib/utils.js';

export default function HistoryPanel() {
  const {
    opsHistory, historyTab, setHistoryTab,
    historyView, setHistoryView, setHistoryOpen,
  } = useApp();

  const items = opsHistory[historyTab] || [];
  const approvedCount = opsHistory.approved.length;
  const rejectedCount = opsHistory.rejected.length;

  return (
    <div className="history-panel">
      <div className="history-panel-head">
        <div>
          <h2>Decision History</h2>
          <p className="muted small">Audit trail of approved and rejected submissions.</p>
        </div>
        <button className="btn ghost small" onClick={() => setHistoryOpen(false)}>✕ Close</button>
      </div>

      <div className="history-controls">
        <div className="history-tabs" role="tablist">
          <button
            className={`history-tab ${historyTab === 'approved' ? 'active' : ''}`}
            onClick={() => setHistoryTab('approved')}
          >
            ✓ Approved <span className="tab-count">{approvedCount}</span>
          </button>
          <button
            className={`history-tab ${historyTab === 'rejected' ? 'active' : ''}`}
            onClick={() => setHistoryTab('rejected')}
          >
            ✕ Rejected <span className="tab-count">{rejectedCount}</span>
          </button>
        </div>
        <div className="history-view-toggle" role="tablist" aria-label="View mode">
          <button
            className={`hv-btn ${historyView === 'grid' ? 'active' : ''}`}
            onClick={() => setHistoryView('grid')}
            title="Grid view" aria-label="Grid view"
          >▦</button>
          <button
            className={`hv-btn ${historyView === 'list' ? 'active' : ''}`}
            onClick={() => setHistoryView('list')}
            title="List view" aria-label="List view"
          >≡</button>
        </div>
      </div>

      <div className={`history-body view-${historyView}`}>
        {items.length === 0 ? (
          <div className="history-empty">
            <h3>No {historyTab} items yet</h3>
            <p className="muted small">
              {historyTab === 'approved'
                ? 'Approved cards will appear here once you act on the queue.'
                : 'Rejected cards (with reason) will appear here once you act on the queue.'}
            </p>
          </div>
        ) : (
          items.map((item) => {
            const orientClass = (item.orientation || 'horizontal') === 'vertical' ? 'vertical' : '';
            const decided = formatDecisionTime(item.decisionAt);
            return (
              <div key={`${item.id}-${item.decisionAt}`} className="hist-item">
                <div className={`ops-thumb ${item.imageUrl ? '' : (item.art || '')} ${orientClass}`}>
                  {item.imageUrl && (
                    <div className="ops-thumb-card" style={{ backgroundImage: `url('${item.imageUrl}')` }}></div>
                  )}
                </div>
                <div className="hist-body">
                  <div className="hist-row">
                    <span className="hist-name">{item.cardholderName || 'Unnamed'}</span>
                    {historyTab === 'approved'
                      ? <span className="hist-tag ok">✓ Approved</span>
                      : <span className="hist-tag bad">✕ Rejected</span>}
                  </div>
                  <div className="hist-meta">
                    <span>{item.id}</span><span>·</span>
                    <span>{decided}</span><span>·</span>
                    <span>Risk {item.risk}/100</span><span>·</span>
                    <span>{item.style || 'mixed'}</span>
                    {item.regenCount != null && <><span>·</span><span>Regens: {item.regenCount}</span></>}
                  </div>
                  {historyTab === 'rejected' && item.reason && (
                    <div className="hist-reason"><strong>Reason:</strong> {item.reason}</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
