'use client';
import { post } from './api';

const b64 = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export const alertsPossible = () =>
  typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

export async function alertState() {
  if (!alertsPossible()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  } catch { return 'off'; }
}

/** Asks this phone for permission and remembers it against the signed-in person. */
export async function turnOnAlerts() {
  if (!alertsPossible()) return { ok: false, error: 'This browser cannot show alerts. On iPhone, install Uzaa to the home screen first.' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, error: 'You said no to alerts. Allow notifications for uzaa.co.ke in your browser settings to turn them on.' };
  const r = await fetch('/api/push/subscribe');
  const { key, ready } = await r.json().catch(() => ({}));
  if (!ready || !key) return { ok: false, error: 'Alerts are not set up on the server yet.' };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
  const j = sub.toJSON();
  const saved = await post('/api/push/subscribe', {
    endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, test: true,
    label: navigator.userAgent.slice(0, 60),
  });
  if (!saved.ok) { try { await sub.unsubscribe(); } catch {} return { ok: false, error: saved.data.error || 'Could not save that' }; }
  return { ok: true };
}

export async function turnOffAlerts() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };
    await post('/api/push/subscribe', { endpoint: sub.endpoint }).catch(() => {});
    await fetch('/api/push/subscribe', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
    return { ok: true };
  } catch (e) { return { ok: false, error: 'Could not turn them off here' }; }
}
