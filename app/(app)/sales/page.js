'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { fmtDate, isoDate, money } from '@/lib/util';
import Modal from '@/components/Modal';
import Receipt from '@/components/Receipt';
import PrintButtons from '@/components/PrintButtons';

export default function Sales() {
  const { business, branches, profile } = useAuth();
  const isCashier = profile.role === 'cashier';
  const [day, setDay] = useState(isoDate(new Date()));
  const [branchId, setBranchId] = useState('');
  const [rows, setRows] = useState([]);
  const [names, setNames] = useState({});
  const [view, setView] = useState(null);
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
    const { data } = await q;
    setRows(data || []);
  }, [day, branchId]);
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
    setView({ sale: s, items: (data || []).map((i) => ({ ...i, qty: Number(i.qty), price: Number(i.price) })) });
  }

  const total = rows.reduce((s, r) => s + Number(r.total), 0);

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
        <div className="kpi"><div className="v">{money(total, business.currency)}</div><div className="l">Total for the day</div></div>
        <div className="kpi"><div className="v">{rows.length}</div><div className="l">Sales</div></div>
      </div>
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
        <Modal onClose={() => setView(null)}>
          <Receipt business={business} branch={branches.find((b) => b.id === view.sale.branch_id)} sale={view.sale} items={view.items} cashier={names[view.sale.cashier_id]} />
          <div className="no-print" style={{ marginTop: 16 }}>
            <PrintButtons saleId={view.sale.id} />
            <button className="btn primary" style={{ width: '100%', marginTop: 12 }} onClick={() => setView(null)}>Close</button>
          </div>
        </Modal>
      )}
    </>
  );
}
