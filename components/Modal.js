'use client';
import { useEffect } from 'react';

export default function Modal({ title, onClose, children }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="modal">
        {title && (
          <div className="row between no-print" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>{title}</h2>
            <button className="btn small" onClick={onClose}>Close</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
