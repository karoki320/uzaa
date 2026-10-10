// Uzaa service worker. Caches only public static files (app shell assets, fonts, icons).
// It never caches pages, API calls or anything that belongs to a signed-in user.
const V = 'uzaa-static-v1';
const PRE = ['/offline.html', '/brand/icon-192.png', '/brand/icon-512.png', '/brand/logo-wordmark.svg', '/brand/logo-mark.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(PRE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).catch(() => caches.match('/offline.html')));
    return;
  }
  const p = u.pathname;
  if (p.startsWith('/_next/static/') || p.startsWith('/fonts/') || p.startsWith('/brand/')) {
    e.respondWith(
      caches.match(r).then((hit) => hit || fetch(r).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put(r, copy)); }
        return res;
      }))
    );
  }
});
