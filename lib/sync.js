'use client';
import { supabase } from './supabase';
import { listQueue, updateSale, removeSale } from './offline';

// Uploads waiting sales one by one, oldest first. Safe to call often: only one run at a time, and the
// server ignores a sale whose client_id it already has, so nothing is ever recorded twice.
let running = false;

// no signal, or the server/gateway is down: try again later. Never treat these as a rejected sale.
export const isNetwork = (e, status) => !!e && (status === 0 || status >= 500 || (!e.code && /fetch|network|load failed|abort/i.test(`${e.message || ''}`)));
const isAuth = (e, status) => !!e && (status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303' || /not signed in|jwt expired/i.test(e.message || ''));

export async function syncQueue(userId) {
  if (running || typeof navigator === 'undefined' || navigator.onLine === false) return { sent: 0, left: 0 };
  running = true;
  let sent = 0;
  let state = 'ok';
  try {
    const q = await listQueue();
    for (const s of q) {
      if (s.user_id !== userId) { state = state === 'ok' ? 'other' : state; continue; }   // belongs to another login
      if (s.status === 'failed') continue;                                              // needs a person
      const { error, status } = await supabase.rpc('create_sale', {
        p_branch: s.branch_id,
        p_items: s.items.map((i) => ({ product_id: i.id, qty: i.qty, price: i.price })),
        p_payment: s.method,
        p_paid: s.paid,
        p_discount: s.discount,
        p_note: s.note || '',
        p_client_id: s.id,
        p_at: s.at,
      });
      if (!error) { await removeSale(s.id); sent += 1; continue; }
      if (isNetwork(error, status)) { state = 'offline'; break; }
      if (isAuth(error, status)) { state = 'signin'; break; }
      await updateSale({ ...s, status: 'failed', error: String(error.message || 'Rejected by the server').slice(0, 200) });
    }
  } catch { state = 'offline'; }
  running = false;
  const left = (await listQueue()).length;
  return { sent, left, state };
}
