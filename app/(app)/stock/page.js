'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { money, num, fmtDate } from '@/lib/util';
import Modal from '@/components/Modal';
import Reorder from '@/components/Reorder';
import CameraScanner from '@/components/CameraScanner';
import { barcodeKeys, findByBarcode } from '@/lib/barcode';

const IN_REASONS = ['Received stock', 'Stock count correction', 'Returned by customer', 'Other'];
const OUT_REASONS = ['Damaged or expired', 'Returned to supplier', 'Stock count correction', 'Used in the shop', 'Other'];

export default function Stock() {
  const { business, branches, profile, reload } = useAuth();
  const [reorder, setReorder] = useState(false);
  const [branchId, setBranchId] = useState(profile.branch_id || branches[0]?.id || '');
  const [products, setProducts] = useState([]);
  const [stock, setStock] = useState({});
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');   // all, low, out
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
      .filter((p) => show === 'all' || (show === 'out' ? p.qty <= 0 : p.qty > 0 && p.qty <= Number(p.low_stock_level)));
  }, [products, stock, q, show]);

  const value = products.reduce((s, p) => s + Math.max(0, stock[p.id] ?? 0) * Number(p.cost), 0);
  const lowCount = products.filter((p) => (stock[p.id] ?? 0) <= Number(p.low_stock_level)).length;
  const outCount = products.filter((p) => (stock[p.id] ?? 0) <= 0).length;
  const noCost = products.filter((p) => !(Number(p.cost) > 0)).length;
  const healthy = products.length ? Math.round(((products.length - lowCount) / products.length) * 100) : 100;
  const C = 2 * Math.PI * 44;

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
        <h1 style={{ margin: 0 }}>Stock</h1>
        {branches.length > 1 && (
          <select className="input" style={{ width: 200, minHeight: 44 }} value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Branch">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      <section className="hero">
        <div className="ring" style={{ width: 116, height: 116 }}>
          <svg width="116" height="116" viewBox="0 0 116 116" role="img" aria-label={`${products.length - lowCount} of ${products.length} items are well stocked`} style={{ filter: 'drop-shadow(0 8px 12px rgba(0,0,0,0.35))' }}>
            <circle cx="58" cy="58" r="44" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="18" />
            <circle cx="58" cy="58" r="44" fill="none" stroke="#85C6C1" strokeWidth="18" strokeLinecap="round" strokeDasharray={`${(healthy / 100) * C} ${C}`} transform="rotate(-90 58 58)" />
          </svg>
          <b>{healthy}%<span>healthy</span></b>
        </div>
        <div style={{ flex: 1, display: 'grid', gap: 8 }}>
          <div><div className="num" style={{ fontSize: 24, fontWeight: 800 }}>{products.length}</div><div className="k">items tracked</div></div>
          <div><div className="num" style={{ fontSize: 24, fontWeight: 800, color: '#F5CF86' }}>{lowCount}</div><div className="k">low or out of stock</div></div>
          <div><div className="num" style={{ fontSize: 18, fontWeight: 800 }}>{noCost === products.length && products.length ? 'Not known' : money(value, business.currency)}</div><div className="k">stock value at cost</div></div>
        </div>
      </section>

      {business.barcode_enabled !== false && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <button className="btn primary" onClick={() => openScan('in')} style={{ minHeight: 54 }}>+ Scan in</button>
          <button className="btn" onClick={() => openScan('out')} style={{ minHeight: 54 }}>− Scan out</button>
        </div>
      )}

      {lowCount > 0 && (
        <button className="card" onClick={() => setReorder(true)} style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
          <span className="rank" style={{ width: 52, height: 52, borderRadius: 18, background: '#25D366', color: '#0b2e17' }} aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h2l2.4 11h11L21 7H7" /><circle cx="9" cy="19" r="1.6" /><circle cx="17" cy="19" r="1.6" /></svg></span>
          <span style={{ flex: 1 }}><b>Reorder {lowCount} low item{lowCount === 1 ? '' : 's'}</b><br /><span className="small muted">Send the list to {business.supplier_name || 'your supplier'} on WhatsApp</span></span>
          <span className="go" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg></span>
        </button>
      )}

      {noCost > 0 && (
        <div className="alert">
          <span className="ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2v20M17 6H9.5a3 3 0 000 6h5a3 3 0 010 6H6" /></svg></span>
          <span>{noCost} item{noCost === 1 ? ' has' : 's have'} no cost price, so stock value and profit are not complete.</span>
          <a href="/products" className="btn small" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Add costs</a>
        </div>
      )}

      <input className="input" placeholder={`Search ${label.toLowerCase()}s or scan a barcode`} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} aria-label="Search stock" />
      <div className="segs" role="tablist" aria-label="Show">
        {[['all', `All ${products.length}`], ['low', `Low ${lowCount - outCount}`], ['out', `Out ${outCount}`]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={show === k} className={show === k ? 'on' : ''} onClick={() => setShow(k)} style={{ flex: 1 }}>{l}</button>
        ))}
      </div>

      <div className="card">
        {rows.map((p) => {
          const warn = Number(p.low_stock_level);
          const st = p.qty <= 0 ? 'out' : p.qty <= warn ? 'low' : 'ok';
          const L = { out: ['var(--c-peach)', '#E08A55', 'Out'], low: ['var(--c-amber)', '#E7AE3E', 'Low'], ok: ['var(--c-teal)', '#4FA39C', 'OK'] }[st];
          return (
            <div className="lrow" key={p.id}>
              <span className="rank" style={{ width: 48, height: 48, borderRadius: 16, fontSize: 15, background: L[0] }}>{num(p.qty)}</span>
              <span className="grow2">
                <b style={{ fontSize: 14 }}>{p.name}</b>
                <div className="lvl"><i style={{ width: `${Math.max(4, Math.min(100, (p.qty / Math.max(1, warn * 3)) * 100))}%`, background: L[1] }} /></div>
                <span>{L[2]} · warn at {num(warn)}</span>
              </span>
              <button className="btn small" onClick={() => { setAdj({ p, change: '', reason: 'Received stock' }); setErr(''); }}>Adjust</button>
            </div>
          );
        })}
        {rows.length === 0 && <p className="muted" style={{ margin: 0 }}>No tracked items found.</p>}
      </div>

      <div className="card">
        <div className="card-head"><h3>Recent stock changes</h3></div>
        {moves.map((m) => (
          <div className="lrow" key={m.id}>
            <span className="rank" style={{ background: Number(m.change) > 0 ? 'var(--c-teal)' : 'var(--c-peach)', fontSize: 13 }}>{Number(m.change) > 0 ? '+' : ''}{num(m.change)}</span>
            <span className="grow2"><b style={{ fontSize: 14 }}>{m.products?.name}</b><span>{m.reason} · {fmtDate(m.created_at)}</span></span>
          </div>
        ))}
        {moves.length === 0 && <p className="muted" style={{ margin: 0 }}>No changes yet.</p>}
      </div>

      {reorder && (
        <Reorder business={business} isOwner={profile.role === 'owner'} onClose={() => setReorder(false)} onSaved={reload}
          items={products.map((p) => ({ ...p, qty: stock[p.id] ?? 0 })).filter((p) => p.qty <= Number(p.low_stock_level)).sort((a, b) => a.qty - b.qty)} />
      )}

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
