'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { num } from '@/lib/util';
import Modal from './Modal';

// Pour / Decant with no setup: pick what you pour from, Uzaa finds the item with the same name to pour into.
// The database takes the stock off one and adds it to the other in one step (pour_between).
const u = (x) => (x && x !== 'pc' ? x : 'pcs');
// "Kenya Love (Wholesale)", "Kenya Love decant 10ml" and "KENYA LOVE" all become "kenya love"
export const baseName = (n) => String(n || '').toLowerCase()
  .replace(/\([^)]*\)/g, ' ')
  .replace(/\b\d+(\.\d+)?\s*(ml|l|cl|g|kg)\b/g, ' ')
  .replace(/\b(wholesale|retail|decants?|display|bottles?|refill|bulk|tester|perfume oil|oil)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const sizeIn = (n) => { const m = String(n || '').toLowerCase().match(/(\d+(?:\.\d+)?)\s*ml\b/); return m ? Number(m[1]) : null; };

export default function PourStock({ branchId, onClose, onDone }) {
  const [products, setProducts] = useState(null);
  const [stock, setStock] = useState({});
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [qty, setQty] = useState('');
  const [per, setPer] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  const load = async () => {
    const [p, s] = await Promise.all([
      supabase.from('products').select('*').eq('active', true).order('name').range(0, 4999),
      supabase.from('stock').select('product_id,qty').eq('branch_id', branchId).range(0, 9999),
    ]);
    if (p.error) { setErr(p.error.message); setProducts([]); return; }
    setProducts(p.data || []);
    setStock(Object.fromEntries((s.data || []).map((x) => [x.product_id, Number(x.qty)])));
  };
  useEffect(() => { load(); }, [branchId]); // eslint-disable-line

  const list = products || [];
  const byId = useMemo(() => Object.fromEntries(list.map((p) => [p.id, p])), [list]);
  const countOf = (p) => (p && !p.track_stock && p.stock_of ? byId[p.stock_of] || p : p);
  const src = byId[fromId];
  const srcCount = countOf(src);
  // things it can pour into: same name, its own stock count, not the same count as the source
  const targets = useMemo(() => {
    if (!src) return [];
    const b = baseName(src.name);
    const sc = countOf(src)?.id;
    return list.filter((p) => p.id !== src.id && baseName(p.name) === b && countOf(p)?.track_stock && countOf(p)?.id !== sc);
  }, [src, list]); // eslint-disable-line
  const dst = byId[toId];
  const sameUnit = src && dst && (src.unit || 'pc') === (dst.unit || 'pc');

  // pick the obvious target, and the obvious "how much each one holds"
  useEffect(() => {
    if (!src) return;
    const t = targets.find((x) => x.id === toId) || targets[0];
    setToId(t ? t.id : '');
  }, [fromId, targets.length]); // eslint-disable-line
  useEffect(() => {
    if (!dst || !src) return;
    if ((src.unit || 'pc') === (dst.unit || 'pc')) setPer('1');
    else setPer(String((dst.refill_from === src.id && dst.refill_qty) || sizeIn(dst.name) || ''));
  }, [toId, fromId]); // eslint-disable-line

  const perN = Number(per) || 0;
  const need = Math.round((Number(qty) || 0) * perN * 1000) / 1000;
  const have = srcCount ? stock[srcCount.id] ?? 0 : 0;
  const short = need > have && !srcCount?.sell_without_stock;
  const sources = list.filter((p) => p.track_stock && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())));

  async function pour(e) {
    e.preventDefault();
    if (!src || !dst) return setErr('Choose what you pour from and into');
    if (!(Number(qty) > 0)) return setErr('Type how much you are making');
    if (!(perN > 0)) return setErr(`Type how many ${u(src.unit)} go into each one`);
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('pour_between', { p_from: src.id, p_to: dst.id, p_branch: branchId, p_qty: Number(qty), p_per: perN, p_note: '' });
    setBusy(false);
    if (error) return setErr(/function .*pour_between/i.test(error.message) ? 'Run security-patch-19.sql in Supabase first.' : error.message);
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
          <p>Took {num(done.took)} {u(done.from_unit)} from {done.from}. {num(done.from_left)} {u(done.from_unit)} left there.</p>
        </div>
        <div className="row">
          <button className="btn grow" onClick={() => { setDone(null); setQty(''); setFromId(''); setQ(''); }}>Pour another</button>
          <button className="btn primary grow" onClick={onClose}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Pour / Decant" onClose={onClose}>
      {products === null ? <p className="muted">Loading...</p> : (
        <form onSubmit={pour}>
          <label className="field"><span>Pour from</span>
            <input className="input" placeholder="Search, e.g. Kenya Love" value={q} onChange={(e) => { setQ(e.target.value); setFromId(''); }} aria-label="Search item to pour from" />
          </label>
          {!src && q.trim() && (
            <div className="card" style={{ padding: '4px 12px', maxHeight: 240, overflowY: 'auto' }}>
              {sources.slice(0, 30).map((p) => (
                <button type="button" key={p.id} className="lrow" onClick={() => { setFromId(p.id); setQ(p.name); setErr(''); }}>
                  <span className="grow2"><b style={{ fontSize: 14 }}>{p.name}</b><span>{num(stock[p.id] ?? 0)} {u(p.unit)} in stock</span></span>
                </button>
              ))}
              {sources.length === 0 && <p className="muted small">No item with stock matches that.</p>}
            </div>
          )}

          {src && (
            <>
              <p className="small" style={{ marginTop: -4 }}>{num(have)} {u(srcCount.unit)} of {srcCount.name} in stock.</p>
              <div className="field"><span>Pour into</span>
                {targets.length === 0
                  ? <p className="small muted" style={{ margin: 0 }}>No other item called “{src.name.replace(/\s*\([^)]*\)/g, '')}” with its own stock. Add the display bottle or decant under Products with the same name.</p>
                  : (
                    <div className="segs" role="radiogroup" aria-label="Pour into" style={{ margin: 0, flexWrap: 'wrap' }}>
                      {targets.map((t) => (
                        <button type="button" key={t.id} role="radio" aria-checked={toId === t.id} className={toId === t.id ? 'on' : ''} onClick={() => setToId(t.id)}>{t.name}</button>
                      ))}
                    </div>
                  )}
              </div>
            </>
          )}

          {src && dst && (
            <>
              <div className="row">
                <label className="field grow"><span>How many {u(dst.unit)}?</span>
                  <input className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={dst.unit === 'ml' ? '150' : '10'} style={{ fontSize: 22, fontWeight: 800 }} />
                </label>
                {!sameUnit && (
                  <label className="field grow"><span>{u(src.unit)} in each</span>
                    <input className="input" inputMode="decimal" value={per} onChange={(e) => setPer(e.target.value)} placeholder="10" style={{ fontSize: 22, fontWeight: 800 }} />
                  </label>
                )}
              </div>
              {Number(qty) > 0 && perN > 0 && (
                <p className="small" style={{ marginTop: -4 }}>
                  Takes {num(need)} {u(src.unit)} from {src.name}, adds {num(Number(qty))} {u(dst.unit)} to {dst.name}.
                </p>
              )}
              {short && <div className="err">Only {num(have)} {u(srcCount.unit)} left. Lower the amount.</div>}
            </>
          )}
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn primary" style={{ width: '100%' }} disabled={busy || !dst || short}>{busy ? 'Pouring...' : 'Pour'}</button>
        </form>
      )}
    </Modal>
  );
}
