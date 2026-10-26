'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { money, num, fmtDate } from '@/lib/util';
import Modal from '@/components/Modal';
import CameraScanner from '@/components/CameraScanner';
import { barcodeKeys, findByBarcode } from '@/lib/barcode';

const IN_REASONS = ['Received stock', 'Stock count correction', 'Returned by customer', 'Other'];
const OUT_REASONS = ['Damaged or expired', 'Returned to supplier', 'Stock count correction', 'Used in the shop', 'Other'];

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
  const router = useRouter();
  const label = business.item_label || 'Product';
  // camera scanning: each scan adds (in) or removes (out) stock straight away
  const [scan, setScan] = useState(false);
  const [dir, setDir] = useState('in');
  const [per, setPer] = useState('1');
  const [reason, setReason] = useState(IN_REASONS[0]);
  const [log, setLog] = useState([]);
  const stockNow = useRef(stock);
  stockNow.current = stock;

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

  function openScan(d) {
    setDir(d);
    setReason(d === 'in' ? IN_REASONS[0] : OUT_REASONS[0]);
    setPer('1');
    setLog([]);
    setScan(true);
  }
  function switchDir(d) {
    setDir(d);
    setReason(d === 'in' ? IN_REASONS[0] : OUT_REASONS[0]);
  }

  async function onScan(code) {
    const qty = Number(per);
    if (!(qty > 0)) return { ok: false, text: 'Set how many each scan counts for (1 or more)' };
    let p = findByBarcode(products, code);
    if (!p) {
      // not a tracked item here: say why
      const { data } = await supabase.from('products').select('id,name,active,track_stock').in('barcode', barcodeKeys(code)).limit(1);
      const o = data?.[0];
      if (!o) return { ok: false, text: `No ${label.toLowerCase()} has barcode ${code}`, action: { label: `Add as new ${label.toLowerCase()}`, run: () => router.push(`/products?barcode=${encodeURIComponent(code)}`) } };
      if (!o.active) return { ok: false, text: `${o.name} is hidden. Show it again under Products first.` };
      return { ok: false, text: `${o.name} does not track stock. Turn on "Track stock" for it under Products.` };
    }
    const change = dir === 'in' ? qty : -qty;
    const have = stockNow.current[p.id] ?? 0;
    if (change < 0 && have + change < 0) return { ok: false, text: `${p.name}: only ${num(have)} in stock, cannot remove ${num(qty)}` };
    const { error } = await supabase.rpc('adjust_stock', { p_product: p.id, p_branch: branchId, p_change: change, p_reason: `${reason} (scanned)` });
    if (error) return { ok: false, text: /fetch|network/i.test(error.message) ? 'No connection. Stock was not changed; scan again when you are online.' : error.message };
    const now = Math.round((have + change) * 1000) / 1000;
    setStock((m) => ({ ...m, [p.id]: now }));
    setLog((l) => [{ key: crypto.randomUUID(), id: p.id, name: p.name, change, reason, now }, ...l]);
    return { ok: true, text: `${p.name} ${change > 0 ? '+' : ''}${num(change)}, now ${num(now)} in stock` };
  }

  async function undo(row) {
    const { error } = await supabase.rpc('adjust_stock', { p_product: row.id, p_branch: branchId, p_change: -row.change, p_reason: 'Scan undone' });
    if (error) return setErr(error.message);
    setStock((m) => ({ ...m, [row.id]: Math.round(((m[row.id] ?? 0) - row.change) * 1000) / 1000 }));
    setLog((l) => l.map((x) => (x.key === row.key ? { ...x, undone: true } : x)));
  }

  const scanned = log.filter((x) => !x.undone);

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
      {business.barcode_enabled !== false && (
        <div className="row" style={{ marginBottom: 12, gap: 8 }}>
          <button className="btn primary grow" onClick={() => openScan('in')}>Scan to add stock</button>
          <button className="btn grow" onClick={() => openScan('out')}>Scan to remove stock</button>
        </div>
      )}
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

      {scan && (
        <CameraScanner title={dir === 'in' ? 'Scan to add stock' : 'Scan to remove stock'} onCode={onScan} onClose={() => { setScan(false); load(); }}>
          <div className="scanmode" role="group" aria-label="Add or remove">
            <button type="button" className={`btn small ${dir === 'in' ? 'on' : ''}`} onClick={() => switchDir('in')}>Add stock</button>
            <button type="button" className={`btn small ${dir === 'out' ? 'on out' : ''}`} onClick={() => switchDir('out')}>Remove stock</button>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <label className="field" style={{ margin: 0, width: 110 }}><span>Each scan</span>
              <input className="input" inputMode="decimal" value={per} onChange={(e) => setPer(e.target.value)} aria-label="Quantity per scan" />
            </label>
            <label className="field grow" style={{ margin: 0 }}><span>Reason</span>
              <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                {(dir === 'in' ? IN_REASONS : OUT_REASONS).map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
          </div>
          <p className="small muted" style={{ margin: '6px 0 0' }}>Tip: for a carton of 24, set Each scan to 24 and scan one item.</p>
          {log.length > 0 && (
            <>
              <div className="scansum">
                <span>{scanned.length} scan(s) saved</span>
                <span className="small muted">{num(scanned.filter((x) => x.change > 0).reduce((t, x) => t + x.change, 0))} in, {num(-scanned.filter((x) => x.change < 0).reduce((t, x) => t + x.change, 0))} out</span>
              </div>
              <div className="scanlog">
                {log.map((x) => (
                  <div key={x.key} className={x.undone ? 'undone' : ''}>
                    <span><b>{x.name}</b> {x.change > 0 ? '+' : ''}{num(x.change)} <span className="muted small">now {num(x.now)}</span></span>
                    {!x.undone && <button className="btn small" onClick={() => undo(x)}>Undo</button>}
                  </div>
                ))}
              </div>
            </>
          )}
          {err && <div className="err">{err}</div>}
        </CameraScanner>
      )}

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
