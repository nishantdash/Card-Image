import { useApp } from '../context/AppContext.jsx';

export default function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  const { tone, message } = toast;
  const icon = tone === 'ok' ? '✓' : tone === 'fail' ? '✕' : 'ℹ';
  return (
    <div className={`toast ${tone || ''}`} key={toast.id}>
      <span className="ic">{icon}</span>
      <span>{message}</span>
    </div>
  );
}
