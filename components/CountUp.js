'use client';
import { useEffect, useRef, useState } from 'react';

// A number that rolls to its new value (about 0.7 s), like a counter. No library needed.
// Screen readers and people who turned off motion get the final value straight away.
export default function CountUp({ value, format = (v) => String(Math.round(v)), duration = 700 }) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(target);
  const from = useRef(0);
  useEffect(() => {
    const still = typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) { setShown(target); from.current = target; return; }
    const start = performance.now();
    const a = from.current;
    let raf;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);                   // ease out
      const v = a + (target - a) * e;
      setShown(t < 1 ? v : target);
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target, duration]);
  // keep whole numbers whole while rolling (KES 1,234 not KES 1,234.57)
  const v = Number.isInteger(target) ? Math.round(shown) : Math.round(shown * 100) / 100;
  return <span className="num" aria-label={format(target)}><span aria-hidden="true">{format(v)}</span></span>;
}
