'use client';
import { useEffect, useRef } from 'react';

// On a phone every pop-up slides up from the bottom as a sheet with a handle: drag it down to close.
// On a computer it is a centred box. Escape closes both.
export default function Modal({ title, onClose, children }) {
  const box = useRef(null);
  const drag = useRef(null);
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';            // the page behind does not scroll with the sheet
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [onClose]);

  // drag down from the handle (or the top of the sheet when it is scrolled to the top)
  const start = (e) => {
    const el = box.current;
    if (!el || el.scrollTop > 0 || window.innerWidth >= 900) return;
    drag.current = { y: e.touches[0].clientY, dy: 0 };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    d.dy = Math.max(0, e.touches[0].clientY - d.y);
    box.current.style.transform = `translateY(${d.dy}px)`;
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !box.current) return;
    box.current.style.transform = '';
    if (d.dy > 110) onClose?.();
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <div className="modal" ref={box} onTouchStart={start} onTouchMove={move} onTouchEnd={end}>
        <div className="grab no-print" aria-hidden="true" />
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
