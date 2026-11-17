'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { num } from '@/lib/util';
import Modal from './Modal';

// Pour / Decant: refill a display bottle or make decants from wholesale stock.
// The database takes the stock off the source and adds it to the item in one step (pour_stock).
const u = (x) => (x && x !== 'pc' ? x : 'pcs');

export default function PourStock({ branchId, onClose, onDone }) {
  // loads its own fresh copy, so the till and the Stock screen can both open it
  const [products, setProducts] = useState(null);
  const [stock, setStock] = useState({});
  const load = async () => {
    const [p, s] = await Promise.all([
      supabase.from('products').select('id,name,unit,track_stock,stock_of,refill_from,refill_qty,sell_without_stock').eq('active', true).order('name').range(0, 4999),
      supabase.from('stock').select('product_id,qty').eq('branch_id', branchId).range(0, 9999),
    ]);
    if (p.error) { setErr(/refill/.test(p.error.message) ? 'Run security-patch-19.sql in Supabase first.' : p.error.message); setProducts([]); return; }
    setProducts(p.data || []);
    setStock(Object.fromEntries((s.data || []).map((x) => [x.product_id, Number(x.qty)])));
  };
  useEffect(() => { load(); }, [branchId]); // eslint-disable-line
  const items = useMemo(() => (products || []).filter((p) => p.refill_from && Number(p.refill_qty) > 0).sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const byId = useMemo(() => Object.fromEntries((products || []).map((p) => [p.id, p])), [products]);
  const [id, setId] = useState('');
  useEffect(() => { if (!id && items[0]) setId(items[0].id); }, [items, id]);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const [q, setQ] = useState('');

  const it = byId[id];
  const src = it && byId[it.refill_from];
  // the stock count each side really uses (shared stock points at the item it sells from)
  const countOf = (p) => (p && !p.track_stock && p.stock_of ? byId[p.stock_of] || p : p);
  const srcCount = countOf(src);
  const need = it ? Math.round((Number(qty) || 0) * Number(it.refill_qty) * 1000) / 1000 : 0;
  const have = srcCount ? stock[srcCount.id] : undefined;
  const short = have !== undefined && need > have && !srcCount?.sell_without_stock;
  const shown = q.trim() ? items.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())) : items;

  async function pour(e) {
    e.preventDefault();
    if (!it) return setErr('Choose what you are filling');
    if (!(Number(qty) > 0)) return setErr('Type how much you are making');
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('pour_stock', { p_item: it.id, p_branch: branchId, p_qty: Number(qty), p_note: note.trim() });
    setBusy(false);
    if (error) return setErr(/function .*pour_stock/i.test(error.message) ? 'Run security-patch-19.sql in Supabase first.' : error.message);
    setDone(data);
    load();
    onDone?.(data);
  }

  if (done) {
    return (
      <Modal title="Poured" onClose={onClose}>
        <div className="hero" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <span className="k">{done.to}</span>
          <div className="big">+{num(done.added)} {u(done.to_unit)}</div>
          <p>Now {num(done.to_now)} {u(done.to_unit)} in stock. Took {num(done.took)} {u(done.from_unit)} from {done.from}: {num(done.from_left)} {u(done.from_unit)} left.</p>
        </div>
        <div className="row">
          <button className="btn grow" onClick={() => { setDone(null); setQty(''); setNote(''); }}>Pour another</button>
          <button className="btn primary grow" onClick={onClose}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Pour / Decant" onClose={onClose}>
      {products === null ? <p className="muted">Loading...</p> : items.length === 0 ? (
        <p className="muted" style={{ marginTop: 0 }}>No item is set up to be refilled yet. In Products, edit the display bottle or decant and choose what it is <b>refilled or decanted from</b>.</p>
      ) : (
        <form onSubmit={pour}>
          {items.length > 6 && <input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} aria-label="Search items" />}
          <label className="field"><span>What are you filling or making?</span>
            <select className="input" value={id} onChange={(e) => { setId(e.target.value); setErr(''); }}>
              {shown.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {it && src && (
            <>
              <label className="field"><span>How much? ({u(it.unit)} of {it.name})</span>
                <input className="input" inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} placeholder={it.unit === 'ml' ? 'e.g. 150' : 'e.g. 10'} style={{ fontSize: 22, fontWeight: 800 }} />
              </label>
              <div className={`card ${short ? '' : ''}`} style={{ padding: 14 }}>
                <div className="row between small"><span className="muted">Takes from {src.name}</span><b>{num(need)} {u(src.unit)}</b></div>
                {have !== undefined && <div className="row between small"><span className="muted">{srcCount.name} has</span><b style={{ color: short ? 'var(--error)' : undefined }}>{num(have)} {u(srcCount.unit)}</b></div>}
                <div className="row between small"><span className="muted">Adds to {it.name}</span><b>+{num(Number(qty) || 0)} {u(it.unit)}</b></div>
                <div className="small muted" style={{ marginTop: 6 }}>1 {u(it.unit).replace(/s$/, '')} uses {num(it.refill_qty)} {u(src.unit)}. Change this under Products.</div>
              </div>
              {short && <div className="err">Not enough {srcCount.name} for that. Lower the amount or add stock first.</div>}
              <label className="field"><span>Note (optional)</span><input className="input" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Display bottle 2" /></label>
            </>
          )}
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn primary" style={{ width: '100%' }} disabled={busy || short}>{busy ? 'Pouring...' : 'Pour'}</button>
        </form>
      )}
    </Modal>
  );
}
