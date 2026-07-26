import { useApp } from '../context/AppContext.jsx';
import ProviderSettings from '../components/ops/ProviderSettings.jsx';
import OpsItem from '../components/ops/OpsItem.jsx';
import HistoryPanel from '../components/ops/HistoryPanel.jsx';
import ArchitectureView from './ArchitectureView.jsx';

export default function OpsView() {
  const {
    opsQueue, opsHistory, historyOpen, setHistoryOpen,
    opsTab, setOpsTab,
    opsLoading, opsError, opsStorage, opsStats, refreshQueue,
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
            {/* Every figure here is derived from real queue data. The previous
                header showed a hardcoded "87% auto-approved" and "4.2s avg
                latency", which invites a question it cannot answer. */}
            <div className="ops-stats">
              <div className="stat"><span className="stat-num">{opsQueue.length}</span><span className="stat-lbl">In Queue</span></div>
              <div className="stat"><span className="stat-num">{opsHistory.approved.length}</span><span className="stat-lbl">Approved</span></div>
              <div className="stat"><span className="stat-num">{opsHistory.rejected.length}</span><span className="stat-lbl">Rejected</span></div>
              <div className="stat">
                <span className="stat-num">
                  {opsStats?.approvalRate == null ? '—' : `${opsStats.approvalRate}%`}
                </span>
                <span className="stat-lbl">Approval rate</span>
              </div>
            </div>
          </div>

          {/* The queue is shared server state. If it is falling back to
              per-instance memory, say so — a queue that quietly forgets
              submissions is worse than one that admits it. */}
          {opsStorage === 'memory' && (
            <div className="settings-warning" style={{ marginBottom: 18 }}>
              <strong>⚠ Queue is not shared.</strong> No KV store is configured, so
              submissions live in a single serverless instance and will disappear on
              redeploy or when a second instance handles the request. Add Vercel&apos;s
              Upstash/KV integration to make the queue durable and visible to every
              reviewer.
            </div>
          )}
          {opsError && (
            <div className="settings-warning" style={{ marginBottom: 18 }}>
              <strong>⚠ Queue unavailable.</strong> {opsError}{' '}
              <button className="btn ghost small" onClick={refreshQueue}>Retry</button>
            </div>
          )}

          <ProviderSettings />

          <div className={`ops-grid ${historyOpen ? 'hidden' : ''}`}>
            {opsLoading ? (
              <div className="card" style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px 20px' }}>
                <div className="spinner" style={{ margin: '0 auto 12px' }}></div>
                <p className="muted small">Loading the review queue…</p>
              </div>
            ) : opsQueue.length === 0 ? (
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
