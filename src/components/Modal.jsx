import { useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';

export default function Modal() {
  const { modal, closeModal } = useApp();

  useEffect(() => {
    if (!modal) return;
    const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal, closeModal]);

  if (!modal) return null;

  const { title, subtitle, body, actions } = modal;

  return (
    <div
      className="modal-backdrop"
      id="modalBackdrop"
      onClick={(e) => { if (e.target.id === 'modalBackdrop') closeModal(); }}
    >
      <div className="modal" id="modal">
        <button className="modal-close" onClick={closeModal} aria-label="Close">×</button>
        <div className="modal-head">
          <h3>{title}</h3>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        <div className="modal-body">{body}</div>
        <div className="modal-actions">
          {(actions || []).map((a, i) => (
            <button
              key={i}
              className={`btn ${a.variant || 'ghost'}`}
              onClick={() => {
                const result = a.handler?.();
                if (result !== false) closeModal();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
