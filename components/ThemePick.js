'use client';
import { useEffect, useState } from 'react';

// Light, dark, or follow the phone. Kept on this phone only (each till can choose).
const KEY = 'uzaa_theme';
export const readTheme = () => { try { return localStorage.getItem(KEY) || 'light'; } catch { return 'light'; } };
export function applyTheme(t) {
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0F1A27' : '#CDD9E2');
}
// runs in <head> before the page paints, so there is no white flash at night
export const THEME_BOOT = "try{var t=localStorage.getItem('uzaa_theme')||'light';var d=t==='dark'||(t==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}";

export default function ThemePick({ label = true }) {
  const [t, setT] = useState('light');
  useEffect(() => { setT(readTheme()); }, []);
  useEffect(() => {
    if (t !== 'auto') return;
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    const f = () => applyTheme('auto');
    m.addEventListener?.('change', f);
    return () => m.removeEventListener?.('change', f);
  }, [t]);
  const pick = (v) => { setT(v); try { localStorage.setItem(KEY, v); } catch {} applyTheme(v); };
  return (
    <div>
      {label && <div className="small muted" style={{ fontWeight: 700, margin: '4px 0 6px' }}>Look on this phone</div>}
      <div className="themepick" role="radiogroup" aria-label="Look">
        {[['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']].map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={t === k} className={t === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>
        ))}
      </div>
    </div>
  );
}
