'use client';
import { supabase } from './supabase';
import { listQueue, updateSale, removeSale, getKv, saveKv } from './offline';
import { post } from './api';

// Uploads waiting sales one by one, oldest first. Safe to call often: only one run at a time, and the
// server ignores a sale whose client_id it already has, so nothing is ever recorded twice.
let running = false;

// no signal, or the server/gateway is down: try again later. Never treat these as a rejected sale.
export const isNetwork = (e, status) => !!e && (status === 0 || status >= 500 || (!e.code && /fetch|network|load failed|abort/i.test(`${e.message || ''}`)));
const isAuth = (e, status) => !!e && (status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303' || /not signed in|jwt expired/i.test(e.message || ''));

// Items added at the till with no signal (QuickAdd) go up first: the sales waiting behind them sell them.
// Returns 'ok', 'offline' or 'signin'. An item the server refuses stays on the phone with the reason.
async function flushProducts(userId) {
  const list = (await getKv('pending_products')) || [];
  if (!list.length) return 'ok';
  const left = [];
  let state = 'ok';
  for (const it of list) {
    if (state !== 'ok' || it.user_id !== userId || it.error) { left.push(it); continue; }
    if (!it.created) {
      let { error, status } = await supabase.from('products').insert(it.row);
      if (error && /added_at_till|needs_count/.test(error.message || '')) {
        const { added_at_till, needs_count, ...older } = it.row;
        ({ error, status } = await supabase.from('products').insert(older));
      }
      if (error && error.code !== '23505') {          // 23505: already uploaded on an earlier try
        if (isNetwork(error, status)) { state = 'offline'; left.push(it); continue; }
        if (isAuth(error, status)) { state = 'signin'; left.push(it); continue; }
        left.push({ ...it, error: String(error.message || 'Rejected').slice(0, 200) }); continue;
      }
      it.created = true;
      if (it.cat_new) supabase.from('categories').insert({ business_id: it.row.business_id, name: it.row.category }).then(() => {});
    }
    if (it.opening > 0 && !it.stocked) {
      const { error, status } = await supabase.rpc('adjust_stock', { p_product: it.row.id, p_branch: it.branch_id, p_change: it.opening, p_reason: 'Opening stock' });
      if (error) {
        if (isNetwork(error, status)) { state = 'offline'; left.push(it); continue; }
        if (!/Not allowed/.test(error.message || '')) { left.push({ ...it, error: String(error.message).slice(0, 200) }); continue; }
      }
      it.stocked = true;
    }
  }
  await saveKv('pending_products', left);
  return state;
}

export async function syncQueue(userId) {
  if (running || typeof navigator === 'undefined' || navigator.onLine === false) return { sent: 0, left: 0 };
  running = true;
  let sent = 0;
  let state = 'ok';
  try {
    const ps = await flushProducts(userId);
    if (ps !== 'ok') { running = false; return { sent: 0, left: (await listQueue()).length, state: ps }; }
    const q = await listQueue();
    for (const s of q) {
      if (s.user_id !== userId) { state = state === 'ok' ? 'other' : state; continue; }   // belongs to another login
      if (s.status === 'failed') continue;                                              // needs a person
      const { data, error, status } = await supabase.rpc('create_sale', {
        p_branch: s.branch_id,
        p_items: s.items.map((i) => ({ product_id: i.id, qty: i.qty, price: i.price, ...(i.free ? { free: true } : {}) })),
        p_payment: s.method,
        p_paid: s.paid,
        p_discount: s.discount,
        p_note: s.note || '',
        p_client_id: s.id,
        p_at: s.at,
        ...(s.payments ? { p_payments: s.payments } : {}),   // a split sale
        ...(s.customer_id ? { p_customer: s.customer_id } : {}),   // loyalty points: an offline sale still earns them when it uploads
      });
      if (!error) { await removeSale(s.id); sent += 1; if (data) post('/api/push/sale', { sale_id: data }).catch(() => {}); continue; }
      if (isNetwork(error, status)) { state = 'offline'; break; }
      if (isAuth(error, status)) { state = 'signin'; break; }
      await updateSale({ ...s, status: 'failed', error: String(error.message || 'Rejected by the server').slice(0, 200) });
    }
  } catch { state = 'offline'; }
  running = false;
  const left = (await listQueue()).length;
  return { sent, left, state };
}
