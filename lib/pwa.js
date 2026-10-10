'use client';
import { useEffect, useState } from 'react';

// The browser decides when an app may be installed and fires one "beforeinstallprompt" event.
// A script in the page head catches it before React starts, so the event is never missed.
const held = () => (typeof window !== 'undefined' ? window.__uzaaBip : null);

const standalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);

export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    window.addEventListener('uzaa-installable', f);
    // the till shell, saved so the app opens with no signal
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then(() => fetch('/pos', { headers: { Accept: 'text/html' }, credentials: 'same-origin' }))
        .catch(() => {});
    }
    return () => window.removeEventListener('uzaa-installable', f);
  }, []);
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
  const installed = standalone();
  return {
    installed,
    canPrompt: !!held() && !installed,
    ios,
    install: async () => {
      const e = held();
      if (!e) return false;
      e.prompt();
      const r = await e.userChoice;
      window.__uzaaBip = null;
      window.dispatchEvent(new Event('uzaa-installable'));
      return r.outcome === 'accepted';
    },
  };
}
