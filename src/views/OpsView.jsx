import { useApp } from '../context/AppContext.jsx';
import ProviderSettings from '../components/ops/ProviderSettings.jsx';
import OpsItem from '../components/ops/OpsItem.jsx';
import HistoryPanel from '../components/ops/HistoryPanel.jsx';
import ArchitectureView from './ArchitectureView.jsx';

export default function OpsView() {
  const {
    opsQueue, opsHistory, historyOpen, setHistoryOpen,
    opsTab, setOpsTab,
  } = useApp();

  const isArch = opsTab === 'architecture';

  return (
    <>
      <div className="ops-subtabs" role="tablist">
        <button
          className={`ops-subtab ${!isArch ? 'active' : ''}`}
          onClick={() => setOpsTab('review')}
          role="tab"
        >
          Review Queue
        </button>
        <button
          className={`ops-subtab ${isArch ? 'active' : ''}`}
          onClick={() => setOpsTab('architecture')}
          role="tab"
        >
          Architecture
        </button>
      </div>

      {isArch ? (
        <ArchitectureView />
      ) : (
        <>
          <div className="ops-header">
            <div className="ops-header-title">
              <h1>Ops Review Dashboard</h1>
              <p className="muted">Items routed for human review after AI moderation.</p>
            </div>
            <button className="history-cta" type="button" onClick={() => setHistoryOpen(!historyOpen)}>
              <span className="history-cta-icon">⟳</span>
              <span className="history-cta-label">History</span>
              <span className="history-cta-counts">
                <span className="hc-approved" title="Approved">
                  <span className="dot ok"></span><span>{opsHistory.approved.length}</span>
                </span>
                <span className="hc-rejected" title="Rejected">
                  <span className="dot bad"></span><span>{opsHistory.rejected.length}</span>
                </span>
              </span>
            </button>
            <div className="ops-stats">
              <div className="stat"><span className="stat-num">{opsQueue.length}</span><span className="stat-lbl">In Queue</span></div>
              <div className="stat"><span className="stat-num">87%</span><span className="stat-lbl">Auto-approved (24h)</span></div>
              <div className="stat"><span className="stat-num">4.2s</span><span className="stat-lbl">Avg AI latency</span></div>
              <div className="stat"><span className="stat-num">0.3%</span><span className="stat-lbl">Fraud blocked</span></div>
            </div>
          </div>

          <ProviderSettings />

          <div className={`ops-grid ${historyOpen ? 'hidden' : ''}`}>
            {opsQueue.length === 0 ? (
              <div className="card" style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px 20px' }}>
                <h3 style={{ marginBottom: 6 }}>Queue is empty</h3>
                <p className="muted small">All submissions have been processed. New customer designs will appear here automatically.</p>
              </div>
            ) : (
              opsQueue.map((item) => <OpsItem key={item.id} item={item} />)
            )}
          </div>

          {historyOpen && <HistoryPanel />}
        </>
      )}
    </>
  );
}
