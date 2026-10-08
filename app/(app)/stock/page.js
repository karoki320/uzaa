'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { money, num, fmtDate } from '@/lib/util';
import Modal from '@/components/Modal';

export default function Stock() {
  const { business, branches, profile } = useAuth();
  const [branchId, setBranchId] = useState(profile.branch_id || branches[0]?.id || '');
  const [products, setProducts] = useState([]);
  const [stock, setStock] = useState({});
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [adj, setAdj] = useState(null);
  const [moves, setMoves] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) return;
    const [p, s, m] = await Promise.all([
      supabase.from('products').select('*').eq('active', true).eq('track_stock', true).order('name').range(0, 4999),
      supabase.from('stock').select('product_id,qty').eq('branch_id', branchId).range(0, 4999),
      supabase.from('stock_movements').select('*, products(name)').eq('branch_id', branchId).order('created_at', { ascending: false }).limit(15),
    ]);
    setProducts(p.data || []);
    const map = {};
    (s.data || []).forEach((x) => (map[x.product_id] = Number(x.qty)));
    setStock(map);
    setMoves(m.data || []);
  }, [branchId]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return products
      .map((p) => ({ ...p, qty: stock[p.id] ?? 0 }))
      .filter((p) => !t || p.name.toLowerCase().includes(t) || (p.barcode || '').includes(t))
      .filter((p) => !onlyLow || p.qty <= Number(p.low_stock_level));
  }, [products, stock, q, onlyLow]);

  const value = products.reduce((s, p) => s + Math.max(0, stock[p.id] ?? 0) * Number(p.cost), 0);
  const lowCount = products.filter((p) => (stock[p.id] ?? 0) <= Number(p.low_stock_level)).length;

  async function save(e) {
    e.preventDefault();
    const change = Number(adj.change);
    if (!change) return setErr('Enter a quantity (use a minus sign to reduce)');
    setBusy(true);
    setErr('');
    const { error } = await supabase.rpc('adjust_stock', { p_product: adj.p.id, p_branch: branchId, p_change: change, p_reason: adj.reason });
    setBusy(false);
    if (error) return setErr(error.message);
    setAdj(null);
    load();
  }

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1>Stock</h1>
        {branches.length > 1 && (
          <select className="input" style={{ width: 220 }} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>
      <div className="kpis">
        <div className="kpi"><div className="v">{products.length}</div><div className="l">Tracked items</div></div>
        <div className="kpi"><div className="v">{lowCount}</div><div className="l">Low or out of stock</div></div>
        <div className="kpi"><div className="v">{money(value, business.currency)}</div><div className="l">Stock value at cost</div></div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input grow" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="row"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Low stock only</label>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th className="num">In stock</th><th className="num">Warn at</th><th></th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td><b>{p.name}</b></td>
                <td className="num">{p.qty <= Number(p.low_stock_level) ? <span className="badge red">{num(p.qty)}</span> : num(p.qty)}</td>
                <td className="num">{num(p.low_stock_level)}</td>
                <td className="right"><button className="btn small" onClick={() => { setAdj({ p, change: '', reason: 'Received stock' }); setErr(''); }}>Receive / adjust</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="4" className="muted">No tracked items found.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Recent stock changes</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Item</th><th className="num">Change</th><th>Reason</th></tr></thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id}><td>{fmtDate(m.created_at)}</td><td>{m.products?.name}</td><td className="num">{Number(m.change) > 0 ? '+' : ''}{num(m.change)}</td><td>{m.reason}</td></tr>
              ))}
              {moves.length === 0 && <tr><td colSpan="4" className="muted">No changes yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {adj && (
        <Modal title={adj.p.name} onClose={() => setAdj(null)}>
          <form onSubmit={save}>
            <p className="muted">Currently {num(stock[adj.p.id] ?? 0)} in stock. Enter a positive number to add, a negative number to remove.</p>
            <label className="field"><span>Quantity change</span><input className="input" autoFocus inputMode="decimal" value={adj.change} onChange={(e) => setAdj({ ...adj, change: e.target.value })} /></label>
            <label className="field"><span>Reason</span>
              <select className="input" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })}>
                {['Received stock', 'Stock count correction', 'Damaged or expired', 'Returned to supplier', 'Other'].map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            {err && <div className="err">{err}</div>}
            <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
          </form>
        </Modal>
      )}
    </>
  );
}
