import { useApp } from '../context/AppContext.jsx';

const TABS = [
  { id: 'customer', label: 'Customer Journey' },
  { id: 'ops', label: 'Ops Dashboard' },
];

export default function TopBar() {
  const { view, setView } = useApp();
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">H</div>
        <div className="brand-text">
          <span className="brand-name">Hyperface</span>
          <span className="brand-sub">AI Card Personalization</span>
        </div>
      </div>
      <nav className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab ${view === t.id ? 'active' : ''}`}
            onClick={() => setView(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="env-pill">
        <span className="dot"></span> Sandbox · v0.3
      </div>
    </header>
  );
}
