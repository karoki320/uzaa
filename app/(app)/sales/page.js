'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import CountUp from '@/components/CountUp';
import CloseDay, { Breakdown } from '@/components/CloseDay';
import { fmtDate, isoDate, money, payLines, payLabel } from '@/lib/util';
import Modal from '@/components/Modal';
import Receipt from '@/components/Receipt';
import PrintButtons from '@/components/PrintButtons';
import EReceiptSend from '@/components/EReceiptSend';

const TONE_BAR = { cash: '#9CCFE0', mpesa: '#85C6C1', card: '#A3A2D8', credit: '#F5CF86', other: '#D6E1E9' };
const TONE_ICON = {
  cash: 'M3 6h18v12H3zM12 9.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z',
  mpesa: 'M7 2h10v20H7zM11 18h2',
  card: 'M3 6h18v12H3zM3 10h18',
  credit: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  other: 'M4 12h16M12 4v16',
};

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
  const [showX, setShowX] = useState(false);   // the Excel download panel
  const [counts, setCounts] = useState([]);     // the day's cash counts (one per branch)
  const [closing, setClosing] = useState(false);
  const [seeCount, setSeeCount] = useState(null);
  const closeBranch = branchId || profile.branch_id || (branches.length === 1 ? branches[0]?.id : '');
  const shift = (n) => { const d = new Date(`${day}T00:00:00`); d.setDate(d.getDate() + n); const k = isoDate(d); if (k <= today) setDay(k); };
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
    let cc = supabase.from('cash_counts').select('*').eq('day', day);
    if (branchId) cc = cc.eq('branch_id', branchId);
    const [{ data }, ex, gd, cr] = await Promise.all([q, e, g || Promise.resolve({ data: [] }), cc]);
    setCounts(cr.error ? [] : cr.data || []);
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
      payLines(r).forEach((p) => {                 // a split sale counts under each of its methods
        const name = p.method || 'Other';
        const k = name.toLowerCase();
        if (!m.has(k)) m.set(k, { name, total: 0, count: 0, unpaid: 0 });
        const x = m.get(k);
        x.total += p.amount; x.count += 1;
        if (k === 'credit') x.unpaid += Math.max(0, Number(r.total) - Number(r.amount_paid || 0));
      });
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
        <h1 style={{ margin: 0 }}>{isCashier ? 'My sales' : 'Sales'}</h1>
        <div className="row" style={{ gap: 8 }}>
          {!isCashier && branches.length > 1 && (
            <select className="input" style={{ width: 170, minHeight: 44 }} value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {!isCashier && (
            <button className="btn small" aria-expanded={showX} onClick={() => setShowX((v) => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></svg>Excel
            </button>
          )}
        </div>
      </div>
      {!isCashier && showX && (
        <div className="card no-print">
          <div className="card-head"><h3>Download sales as Excel</h3><button className="btn small" onClick={() => setShowX(false)}>Close</button></div>
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

      <div className="datenav">
        <button className="round" aria-label="Previous day" onClick={() => shift(-1)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg></button>
        <input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Day" />
        <button className="round" aria-label="Next day" disabled={day >= today} onClick={() => shift(1)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg></button>
      </div>

      <section className="hero" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="k">{day === today ? 'Total for today' : `Total for ${new Date(`${day}T00:00:00`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}`}</span>
          <span style={{ padding: '4px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.12)', fontSize: 12, fontWeight: 700 }}>{rows.length} sale{rows.length === 1 ? '' : 's'}</span>
        </div>
        <div className="big" style={{ marginTop: 6 }}><CountUp value={total} format={(v) => money(v, business.currency)} /></div>
        <div className="splitbar" role="img" aria-label={byMethod.map((x) => `${x.name} ${money(x.total, business.currency)}`).join(', ')}>
          {byMethod.filter((x) => x.total > 0).map((x) => <i key={x.name} style={{ width: `${(x.total / (total || 1)) * 100}%`, background: TONE_BAR[tone(x.name)] }} />)}
        </div>
        <p style={{ fontSize: 12 }}>{byMethod.length > 1 ? `${byMethod.map((x) => x.name).join(' and ')} add up to the total` : 'All sales for the day'}</p>
      </section>

      <div className="kpis">
        {byMethod.map((x) => (
          <div className={`kpi pm ${tone(x.name)}`} key={x.name}>
            <span className="ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={TONE_ICON[tone(x.name)]} /></svg></span>
            <div className="l">{x.name}</div>
            <div className="v">{money(x.total, business.currency)}</div>
            <div className="s">{x.count} sale{x.count === 1 ? '' : 's'}{total > 0 ? ` · ${Math.round((x.total / total) * 100)}%` : ''}{x.unpaid > 0 ? ` · ${money(x.unpaid, business.currency)} not paid yet` : ''}</div>
          </div>
        ))}
      </div>
      {(spent.length > 0 || cashSales > 0) && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="rank" style={{ width: 52, height: 52, borderRadius: 18, background: 'var(--c-lav)' }} aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2E2A5C" strokeWidth="2" strokeLinecap="round"><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M3 11h18M8 15h3" /></svg></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="small" style={{ fontWeight: 700, color: 'var(--muted)' }}>Cash that should be in the drawer</div>
            <div className="num" style={{ fontSize: 24, fontWeight: 800 }}>{money(cashSales - cashSpent, business.currency)}</div>
            <div className="small muted">Cash sales {money(cashSales, business.currency)} less cash expenses {money(cashSpent, business.currency)}{spent.length ? ` · ${spent.length} expense${spent.length === 1 ? '' : 's'}, ${money(spentTotal, business.currency)} in all` : ''}</div>
          </div>
        </div>
      )}

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {counts.length === 0 ? (
          <>
            <span className="rank" style={{ width: 52, height: 52, borderRadius: 18, background: 'var(--c-ice)' }} aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2B4E68" strokeWidth="2" strokeLinecap="round"><path d="M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2" /></svg></span>
            <span style={{ flex: 1, minWidth: 160 }}><b>Close the day</b><br /><span className="small muted">Count the cash in the drawer. Uzaa checks it and tells the owner.</span></span>
            {closeBranch
              ? <button className="btn primary" onClick={() => setClosing(true)}>Count cash</button>
              : <span className="small muted">Pick a branch above to close it.</span>}
          </>
        ) : counts.map((c) => {
          const d = Number(c.diff);
          return (
            <button key={c.id} className="lrow" onClick={() => setSeeCount(c)} style={{ borderBottom: 0 }}>
              <span className="rank" style={{ width: 52, height: 52, borderRadius: 18, background: d === 0 ? 'var(--c-teal)' : d < 0 ? 'var(--c-peach)' : 'var(--c-amber)' }}>{d === 0 ? 'OK' : d < 0 ? 'Short' : 'Over'}</span>
              <span className="grow2"><b style={{ fontSize: 14 }}>{d === 0 ? 'Day closed: cash balanced' : d < 0 ? `Day closed: short ${money(-d, business.currency)}` : `Day closed: over ${money(d, business.currency)}`}</b>
                <span>Counted {money(c.counted, business.currency)} of {money(c.expected, business.currency)}{branches.length > 1 ? ` · ${branches.find((b) => b.id === c.branch_id)?.name || ''}` : ''} · {names[c.user_id] || 'staff'}</span></span>
              <span className="go" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg></span>
            </button>
          );
        })}
      </div>
      {closing && <CloseDay business={business} branchId={closeBranch} day={day} onClose={() => { setClosing(false); load(); }} />}
      {seeCount && (
        <Modal title="Cash count" onClose={() => setSeeCount(null)}>
          <Breakdown r={seeCount} cur={business.currency} />
          {(seeCount.branch_id === closeBranch) && <button className="btn" style={{ width: '100%' }} onClick={() => { setSeeCount(null); setClosing(true); }}>Count again</button>}
        </Modal>
      )}

      <div className="card">
        <div className="card-head"><h3>Receipts</h3><span className="pill">Newest first</span></div>
        {rows.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '12px 4px', textAlign: 'center' }}>
            <span className="rank" style={{ width: 60, height: 60, borderRadius: 20, background: 'var(--c-ice)' }} aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2B4E68" strokeWidth="1.8" strokeLinecap="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h4" /></svg></span>
            <b>{day === today ? 'No sales yet today' : 'No sales on this day'}</b>
            {day === today && <Link href="/pos" className="btn primary small" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Open the till</Link>}
          </div>
        )}
        {rows.map((s) => (
          <button className="lrow" key={s.id} onClick={() => open(s)}>
            <span className="rank" style={{ background: `var(--c-${tone(s.payment_method || '') === 'mpesa' ? 'teal' : tone(s.payment_method || '') === 'credit' ? 'amber' : tone(s.payment_method || '') === 'card' ? 'lav' : 'ice'})`, fontSize: 11 }}>{s.payments ? 'Split' : (s.payment_method || '?').slice(0, 4)}</span>
            <span className="grow2">
              <b style={{ fontSize: 14 }}>#{s.receipt_no} · {payLabel(s)}
                {s.offline && <span className="badge" style={{ marginLeft: 6 }}>offline</span>}
                {s.price_diff && <span className="badge red" style={{ marginLeft: 6 }} title="Sold at a price different from the list price">price differs</span>}</b>
              <span>{new Date(s.created_at).toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' })} · {names[s.cashier_id] || '-'}{branches.length > 1 ? ` · ${branches.find((b) => b.id === s.branch_id)?.name || ''}` : ''}</span>
            </span>
            <span className="amt">{money(s.total, business.currency)}</span>
            <span className="go" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg></span>
          </button>
        ))}
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
