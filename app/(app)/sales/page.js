'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { fmtDate, isoDate, money } from '@/lib/util';
import Modal from '@/components/Modal';
import Receipt from '@/components/Receipt';
import PrintButtons from '@/components/PrintButtons';
import EReceiptSend from '@/components/EReceiptSend';

export default function Sales() {
  const { business, branches, profile } = useAuth();
  const isCashier = profile.role === 'cashier';
  const [day, setDay] = useState(isoDate(new Date()));
  const [branchId, setBranchId] = useState('');
  const [rows, setRows] = useState([]);
  const [names, setNames] = useState({});
  const [view, setView] = useState(null);
  const [eSend, setESend] = useState(null);
  const [spent, setSpent] = useState([]);       // expenses recorded for this day
  const [gone, setGone] = useState([]);         // sales deleted from this day (owner and managers)
  const [del, setDel] = useState(null);         // { reason, busy, err } while the owner deletes the open sale
  const isOwner = profile.role === 'owner';
  const today = isoDate(new Date());
  const [xf, setXf] = useState(today.slice(0, 8) + '01');
  const [xt, setXt] = useState(today);
  const [xb, setXb] = useState('');
  const xlsxUrl = `/api/export/sales?from=${xf}&to=${xt}${xb ? `&branch=${xb}` : ''}`;

  const load = useCallback(async () => {
    const from = new Date(`${day}T00:00:00`);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    let q = supabase.from('sales').select('*').gte('created_at', from.toISOString()).lt('created_at', to.toISOString()).order('created_at', { ascending: false }).limit(500);
    if (branchId) q = q.eq('branch_id', branchId);
    let e = supabase.from('expenses').select('amount,paid_from,branch_id').eq('spent_on', day).range(0, 999);
    if (branchId) e = e.eq('branch_id', branchId);
    let g = isCashier ? null : supabase.from('sale_deletions').select('*').gte('sold_at', from.toISOString()).lt('sold_at', to.toISOString()).order('created_at', { ascending: false }).limit(100);
    if (g && branchId) g = g.eq('branch_id', branchId);
    const [{ data }, ex, gd] = await Promise.all([q, e, g || Promise.resolve({ data: [] })]);
    setRows(data || []);
    setSpent(ex.error ? [] : ex.data || []);     // before patch 13 the table is missing: show no expenses
    setGone(gd?.error ? [] : gd?.data || []);
  }, [day, branchId, isCashier]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (isCashier) return setNames({ [profile.id]: profile.full_name });
    supabase.from('profiles').select('id,full_name').then(({ data }) => {
      const m = {};
      (data || []).forEach((p) => (m[p.id] = p.full_name));
      setNames(m);
    });
  }, [isCashier, profile]);

  async function open(s) {
    const { data } = await supabase.from('sale_items').select('name,qty,price,unit').eq('sale_id', s.id);
    let cust = null;
    if (s.customer_id) ({ data: cust } = await supabase.from('customers').select('name,phone').eq('id', s.customer_id).maybeSingle());
    setView({ sale: s, cust, items: (data || []).map((i) => ({ ...i, qty: Number(i.qty), price: Number(i.price) })) });
  }

  const total = rows.reduce((s, r) => s + Number(r.total), 0);

  // one tile per way of paying (Cash, M-Pesa, Card, Credit ...); together they add up to the day's total
  const byMethod = useMemo(() => {
    const m = new Map();
    (business.payment_methods || ['Cash']).forEach((k) => m.set(k.toLowerCase(), { name: k, total: 0, count: 0, unpaid: 0 }));
    rows.forEach((r) => {
      const name = r.payment_method || 'Other';
      const k = name.toLowerCase();
      if (!m.has(k)) m.set(k, { name, total: 0, count: 0, unpaid: 0 });
      const x = m.get(k);
      x.total += Number(r.total) || 0; x.count += 1;
      if (k === 'credit') x.unpaid += Math.max(0, Number(r.total) - Number(r.amount_paid || 0));
    });
    return [...m.values()].filter((x) => x.count > 0 || ['cash', 'm-pesa', 'mpesa'].includes(x.name.toLowerCase()));
  }, [rows, business.payment_methods]);
  const spentTotal = spent.reduce((s, e) => s + Number(e.amount), 0);
  const cashSales = byMethod.find((x) => x.name.toLowerCase() === 'cash')?.total || 0;
  const cashSpent = spent.filter((e) => (e.paid_from || '').toLowerCase() === 'cash').reduce((s, e) => s + Number(e.amount), 0);
  const tone = (n) => { const k = n.toLowerCase().replace(/[^a-z]/g, ''); return k === 'cash' ? 'cash' : k === 'mpesa' ? 'mpesa' : k === 'credit' ? 'credit' : k === 'card' ? 'card' : 'other'; };

  async function removeSale() {
    if (!del || del.reason.trim().length < 3) return setDel({ ...del, err: 'Write why this sale is being deleted' });
    setDel({ ...del, busy: true, err: '' });
    const { error } = await supabase.rpc('delete_sale', { p_sale: view.sale.id, p_reason: del.reason.trim() });
    if (error) return setDel({ ...del, busy: false, err: /function .*delete_sale/i.test(error.message) ? 'Run security-patch-13.sql in Supabase first.' : error.message });
    setDel(null); setView(null); load();
  }

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1>{isCashier ? 'My sales' : 'Sales'}</h1>
        <div className="row">
          <input className="input" type="date" style={{ width: 180 }} value={day} onChange={(e) => setDay(e.target.value)} />
          {!isCashier && branches.length > 1 && (
            <select className="input" style={{ width: 200 }} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
      </div>
      {!isCashier && (
        <div className="card no-print">
          <h3>Download sales as Excel</h3>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field grow" style={{ marginBottom: 0 }}><span>From</span><input className="input" type="date" value={xf} max={xt} onChange={(e) => setXf(e.target.value)} /></label>
            <label className="field grow" style={{ marginBottom: 0 }}><span>To</span><input className="input" type="date" value={xt} min={xf} onChange={(e) => setXt(e.target.value)} /></label>
            {branches.length > 1 && (
              <label className="field grow" style={{ marginBottom: 0 }}><span>Branch</span>
                <select className="input" value={xb} onChange={(e) => setXb(e.target.value)}>
                  <option value="">All branches</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
            <a className="btn primary" href={xlsxUrl} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Download Excel</a>
          </div>
          <p className="muted small" style={{ margin: '8px 0 0' }}>One file with every sale, every item sold, and totals by payment method. Up to one year at a time.</p>
        </div>
      )}
      <div className="kpis">
        <div className="kpi total"><div className="v">{money(total, business.currency)}</div><div className="l">Total for the day</div><div className="s">{rows.length} sale{rows.length === 1 ? '' : 's'}</div></div>
        {byMethod.map((x) => (
          <div className={`kpi pm ${tone(x.name)}`} key={x.name}>
            <div className="v">{money(x.total, business.currency)}</div>
            <div className="l">{x.name}</div>
            <div className="s">{x.count} sale{x.count === 1 ? '' : 's'}{total > 0 ? ` · ${Math.round((x.total / total) * 100)}%` : ''}{x.unpaid > 0 ? ` · ${money(x.unpaid, business.currency)} not paid yet` : ''}</div>
          </div>
        ))}
      </div>
      {(spent.length > 0 || cashSales > 0) && (
        <div className="kpis">
          <div className="kpi pm spent"><div className="v">{money(spentTotal, business.currency)}</div><div className="l">Expenses {isCashier ? 'you recorded' : 'today'}</div><div className="s">{spent.length} item{spent.length === 1 ? '' : 's'}</div></div>
          <div className="kpi pm cash"><div className="v">{money(cashSales - cashSpent, business.currency)}</div><div className="l">Cash that should be in the drawer</div><div className="s">Cash sales {money(cashSales, business.currency)} less cash expenses {money(cashSpent, business.currency)}</div></div>
        </div>
      )}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Receipt</th><th>Time</th><th>Branch</th><th>Cashier</th><th>Paid by</th><th className="num">Total</th><th></th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>#{s.receipt_no}{s.offline && <span className="badge" style={{ marginLeft: 6 }}>offline</span>}{s.price_diff && <span className="badge" style={{ marginLeft: 6, color: 'var(--error)' }} title="Sold at a price different from the list price">price differs</span>}</td>
                <td>{fmtDate(s.created_at)}</td>
                <td>{branches.find((b) => b.id === s.branch_id)?.name}</td>
                <td>{names[s.cashier_id] || '-'}</td>
                <td>{s.payment_method}</td>
                <td className="num">{money(s.total, business.currency)}</td>
                <td className="right"><button className="btn small" onClick={() => open(s)}>View</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="7" className="muted">No sales on this day.</td></tr>}
          </tbody>
        </table>
      </div>

      {view && (
        <Modal onClose={() => { setView(null); setDel(null); }}>
          <Receipt business={business} branch={branches.find((b) => b.id === view.sale.branch_id)} sale={view.sale} items={view.items} cashier={names[view.sale.cashier_id]} />
          <div className="no-print" style={{ marginTop: 16 }}>
            <PrintButtons saleId={view.sale.id} />
            {business.ereceipt_enabled && (
              <button className="btn" style={{ width: '100%', marginTop: 12, background: '#25D366', borderColor: '#25D366', color: '#0b2e17' }} onClick={() => { setESend(view); setView(null); }}>Send e-receipt on WhatsApp</button>
            )}
            {isOwner && !del && (
              <button className="btn danger" style={{ width: '100%', marginTop: 12 }} onClick={() => setDel({ reason: '', busy: false, err: '' })}>Delete this sale</button>
            )}
            {isOwner && del && (
              <div className="card" style={{ marginTop: 12, borderColor: 'var(--error)' }}>
                <b>Delete sale #{view.sale.receipt_no}?</b>
                <p className="small muted" style={{ margin: '6px 0 10px' }}>The items go back into stock and the sale leaves every total and report. A copy is kept with your name and the reason.</p>
                <label className="field"><span>Why? (for example: cashier sold the wrong item)</span>
                  <input className="input" maxLength={300} autoFocus value={del.reason} onChange={(e) => setDel({ ...del, reason: e.target.value, err: '' })} />
                </label>
                {del.err && <div className="err" role="alert">{del.err}</div>}
                <div className="row">
                  <button className="btn danger grow" disabled={del.busy} onClick={removeSale}>{del.busy ? 'Deleting...' : 'Yes, delete it'}</button>
                  <button className="btn grow" disabled={del.busy} onClick={() => setDel(null)}>Keep it</button>
                </div>
              </div>
            )}
            <button className="btn primary" style={{ width: '100%', marginTop: 12 }} onClick={() => { setView(null); setDel(null); }}>Close</button>
          </div>
        </Modal>
      )}
      {gone.length > 0 && (
        <details className="card" style={{ marginTop: 16 }}>
          <summary><b>{gone.length} deleted sale{gone.length === 1 ? '' : 's'} on this day</b></summary>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Receipt</th><th>Sold</th><th>Paid by</th><th className="num">Total</th><th>Deleted by</th><th>Why</th></tr></thead>
              <tbody>
                {gone.map((g) => (
                  <tr key={g.id}>
                    <td>#{g.receipt_no}</td>
                    <td>{fmtDate(g.sold_at)}</td>
                    <td>{g.payment_method}</td>
                    <td className="num">{money(g.total, business.currency)}</td>
                    <td>{names[g.deleted_by] || '-'}<div className="small muted">{fmtDate(g.created_at)}</div></td>
                    <td>{g.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {eSend && (
        <EReceiptSend business={business} sale={eSend.sale} phone={eSend.cust?.phone || ''} name={eSend.cust?.name || ''} onClose={() => setESend(null)} />
      )}
    </>
  );
}
