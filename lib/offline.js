'use client';
// On-phone storage for offline selling (IndexedDB, no extra libraries).
//  kv      : a copy of the shop (products, stock, settings) so the till opens with no signal
//  outbox  : sales made without internet, waiting to upload
// No sign-in token is ever stored here. Cost prices are never copied to the phone.

const DB = 'uzaa';
let dbp;
function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('No storage'));
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
const run = (store, mode, fn) =>
  open().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));

const changed = () => { try { window.dispatchEvent(new Event('uzaa-queue')); } catch {} };

// ---- shop copy ----
export const saveKv = (k, v) => run('kv', 'readwrite', (s) => s.put(v, k)).catch(() => {});
export const getKv = (k) => run('kv', 'readonly', (s) => s.get(k)).catch(() => undefined);

// ---- outbox ----
export const queueSale = async (sale) => { await run('outbox', 'readwrite', (s) => s.put(sale)); changed(); };
export const updateSale = async (sale) => { await run('outbox', 'readwrite', (s) => s.put(sale)); changed(); };
export const removeSale = async (id) => { await run('outbox', 'readwrite', (s) => s.delete(id)); changed(); };
export const listQueue = async () => {
  const all = (await run('outbox', 'readonly', (s) => s.getAll()).catch(() => [])) || [];
  return all.sort((a, b) => a.at.localeCompare(b.at));
};

// local receipt label for sales made offline (A-0001, A-0002 ...), kept per phone
export async function nextLocalNo() {
  const n = ((await getKv('local_no')) || 0) + 1;
  await saveKv('local_no', n);
  return `L-${String(n).padStart(4, '0')}`;
}

// sign-out: drop the shop copy but never the unsent sales
export const clearShopCopy = () => Promise.all(['me', 'products', 'stock'].map((k) => run('kv', 'readwrite', (s) => s.delete(k)).catch(() => {})));

export const strip = (p) => { const { cost, ...rest } = p; return rest; };
