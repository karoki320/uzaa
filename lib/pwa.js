'use client';
import { useEffect, useState } from 'react';

let deferred = null;
const subs = new Set();
const notify = () => subs.forEach((f) => f());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
}

const standalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);

// Registers the service worker (call only for signed-in users) and exposes install state.
export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const ios = /iphone|ipad|ipod/i.test(ua);
  const installed = standalone();
  return {
    installed,
    canPrompt: !!deferred && !installed,
    ios: ios && !installed,
    install: async () => {
      if (!deferred) return false;
      deferred.prompt();
      const r = await deferred.userChoice;
      deferred = null; notify();
      return r.outcome === 'accepted';
    },
  };
}
