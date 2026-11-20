'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { money } from '@/lib/util';
import { getKv, saveKv, strip } from '@/lib/offline';
import { isNetwork } from '@/lib/sync';
import Modal from '@/components/Modal';
import { similar, guessCategory, looksLikeCode, isLabel } from '@/lib/quickadd';

// Quick add at the till (patch 25). The cashier types a name and a price, Uzaa creates the item and puts it
// straight into the sale. Close matches already in the shop are shown first so the same item is not added twice.
// Works offline: the new item is kept on the phone and uploads before the sales that use it.
export default function QuickAdd({ text, products, business, branchId, userId, canSeeCost, onSell, onCreated, onClose }) {
  const code = looksLikeCode(text) ? text.trim() : '';
  const [name, setName] = useState(code ? '' : text.trim());
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [qty, setQty] = useState('');
  const shopCats = useMemo(() => [...new Set(products.map((p) => (p.category || '').trim()).filter(Boolean))].sort(), [products]);
  const guess = useMemo(() => guessCategory(name, products, shopCats), [name, products, shopCats]);
  const [cat, setCat] = useState(null);          // null = use the guess; '' = no category; text = chosen
  const [catOpen, setCatOpen] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const priceRef = useRef(null);
  const nameRef = useRef(null);
  useEffect(() => { setTimeout(() => (name ? priceRef : nameRef).current?.focus(), 60); }, []); // eslint-disable-line

  const matches = useMemo(() => similar(name, products), [name, products]);
  const same = matches.find((m) => m.same);
  const category = (cat === null ? guess : cat).trim();
  const cur = business.currency;
  const n = name.trim();
  const p = Number(price);
  const ok = n.length >= 2 && p > 0 && !same && !busy;

  async function save(e) {
    e?.preventDefault();
    if (!ok) return setErr(n.length < 2 ? 'Type the name' : !(p > 0) ? 'Type the selling price' : '');
    setBusy(true); setErr('');
    const opening = Math.max(0, Math.round((Number(qty) || 0) * 1000) / 1000);
    const row = {
      id: crypto.randomUUID(),
      business_id: business.id,
      name: n.slice(0, 120),
      barcode: code || null,
      category: category.slice(0, 60),
      unit: 'pc',
      price: p,
      cost: canSeeCost ? Number(cost) || 0 : 0,
      track_stock: true,
      low_stock_level: 0,
      custom: {},
      active: true,
      sell_without_stock: !(opening > 0),   // no count yet: never block the sale
      added_at_till: true,
      needs_count: !(opening > 0),
    };
    const till = strip(row);   // the till's copy never holds cost prices

    // no signal: keep it on this phone; it uploads before the sale that uses it
    const keep = async () => {
      const list = (await getKv('pending_products')) || [];
      await saveKv('pending_products', [...list, { row, opening, branch_id: branchId, user_id: userId, cat_new: isNewCat(category) }]);
      setBusy(false);
      onCreated(till, opening, true);
    };
    if (!navigator.onLine) return keep();

    let { error, status } = await supabase.from('products').insert(row);
    if (error && /added_at_till|needs_count/.test(error.message || '')) {   // patch 25 not run yet: still add it
      const { added_at_till, needs_count, ...older } = row;
      ({ error, status } = await supabase.from('products').insert(older));
    }
    if (error) {
      if (isNetwork(error, status)) return keep();
      setBusy(false);
      if (/products_barcode_uq/.test(error.message)) return setErr('That barcode is already used by another item');
      if (/row-level security|Not allowed/i.test(error.message)) return setErr('You are not allowed to add items. Ask the owner to turn on Settings > Staff permissions > Cashiers can add new items.');
      return setErr(error.message);
    }
    if (isNewCat(category)) supabase.from('categories').insert({ business_id: business.id, name: category }).then(() => {});
    if (opening > 0) {
      const r = await supabase.rpc('adjust_stock', { p_product: row.id, p_branch: branchId, p_change: opening, p_reason: 'Opening stock' });
      if (r.error) {
        setBusy(false);
        return setErr(`${n} was added, but the stock count could not be saved (${r.error.message}). Close this, search for it and sell it, then add the stock under Stock.`);
      }
    }
    setBusy(false);
    onCreated(till, opening, false);
  }
  const isNewCat = (c) => !!c && !shopCats.some((x) => x.toLowerCase() === c.toLowerCase());

  return (
    <Modal title="Add and sell" onClose={onClose}>
      <form onSubmit={save} style={{ display: 'grid', gap: 10 }}>
        {code && <div className="tint small">Barcode <b>{code}</b> is not in your shop yet. Type its name and price to sell it.</div>}
        <label className="small muted" htmlFor="qa-name">Name</label>
        <input id="qa-name" ref={nameRef} className="input" value={name} maxLength={120} autoComplete="off"
          onChange={(e) => { setName(e.target.value); setErr(''); }} placeholder="e.g. Oraimo charger" />

        {matches.length > 0 && (
          <div className="card" style={{ padding: 10, display: 'grid', gap: 6 }}>
            <span className="small muted">{same ? 'Already in your shop:' : 'Did you mean?'}</span>
            {matches.map((m) => (
              <button type="button" key={m.id} className="btn small" style={{ justifyContent: 'space-between', display: 'flex', width: '100%' }} onClick={() => onSell(m)}>
                <span style={{ textAlign: 'left' }}>{m.name}</span><b>{money(m.price, cur)} · Sell</b>
              </button>
            ))}
            {same && <span className="small" style={{ color: '#7A2A00' }}>Sell the one above, or change the name if this is a different item.</span>}
          </div>
        )}

        <div className="row" style={{ gap: 8 }}>
          <div className="grow" style={{ display: 'grid', gap: 4 }}>
            <label className="small muted" htmlFor="qa-price">Selling price ({cur})</label>
            <input id="qa-price" ref={priceRef} className="input" inputMode="decimal" value={price}
              onChange={(e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && setPrice(e.target.value)} placeholder="0" />
          </div>
          <div className="grow" style={{ display: 'grid', gap: 4 }}>
            <label className="small muted" htmlFor="qa-qty">In stock (optional)</label>
            <input id="qa-qty" className="input" inputMode="decimal" value={qty}
              onChange={(e) => /^\d*\.?\d{0,3}$/.test(e.target.value) && setQty(e.target.value)} placeholder="Count later" />
          </div>
        </div>
        {canSeeCost && (
          <div style={{ display: 'grid', gap: 4 }}>
            <label className="small muted" htmlFor="qa-cost">What you paid (optional)</label>
            <input id="qa-cost" className="input" inputMode="decimal" value={cost}
              onChange={(e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && setCost(e.target.value)} placeholder="Add later under Products" />
          </div>
        )}

        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="small muted">Category:</span>
          <button type="button" className="btn small" onClick={() => setCatOpen((v) => !v)} aria-expanded={catOpen}>
            {category || 'None'}{cat === null && guess ? ' (guessed)' : ''} ✎
          </button>
        </div>
        {catOpen && (
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            <button type="button" className={category === '' ? 'on' : ''} onClick={() => { setCat(''); setCatOpen(false); }}>None</button>
            {shopCats.filter((c) => !isLabel(c)).map((c) => (
              <button type="button" key={c} className={category === c ? 'on' : ''} onClick={() => { setCat(c); setCatOpen(false); }}>{c}</button>
            ))}
            <span className="row" style={{ gap: 6, width: '100%' }}>
              <input className="input grow" value={newCat} maxLength={60} placeholder="New category" onChange={(e) => setNewCat(e.target.value)} />
              <button type="button" className="btn small" disabled={!newCat.trim()} onClick={() => { setCat(newCat.trim()); setCatOpen(false); }}>Use</button>
            </span>
          </div>
        )}

        {err && <div className="err" role="alert" style={{ margin: 0 }}>{err}</div>}
        <button type="submit" className="btn primary" disabled={!ok} style={{ minHeight: 48 }}>
          {busy ? 'Adding...' : p > 0 && n ? `Add and sell · ${money(p, cur)}` : 'Add and sell'}
        </button>
        <span className="small muted">It is saved under Products as "Added at the till" so the owner can check the name and price.{!(Number(qty) > 0) ? ' With no stock count it sells anyway until someone counts it.' : ''}</span>
      </form>
    </Modal>
  );
}
