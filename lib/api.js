'use client';
// Small helper for our own auth endpoints. Returns { ok, status, data } and never throws.
export async function post(path, body = {}) {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'No connection. Check your internet and try again.' } };
  }
}
export const go = (to) => window.location.assign(to);
