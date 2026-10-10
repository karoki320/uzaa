'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { money, num, stepFor } from '@/lib/util';
import { post } from '@/lib/api';
import { paperWidth, schemeUrl } from '@/lib/printclient';

export default function POS() {
  const { profile, business, branches } = useAuth();
  const isCashier = profile.role === 'cashier';
  const [branchId, setBranchId] = useState(profile.branch_id || branches[0]?.id || '');
  const [products, setProducts] = useState([]);
  const [stock, setStock] = useState({});
  const [q, setQ] = useState('');
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState('');
  const methods = business.payment_methods?.length ? business.payment_methods : ['Cash'];
  const [method, setMethod] = useState(methods[0]);
  const [paid, setPaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cat, setCat] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const cartRef = useRef(null);
  const [flash, setFlash] = useState(null);
  const input = useRef(null);
  const mode = business.receipt_mode || 'always';
  const barcodeOn = business.barcode_enabled !== false;
  const label = business.item_label || 'Product';

  useEffect(() => {
    supabase.from('products').select('*').eq('active', true).order('name').range(0, 4999)
      .then(({ data }) => setProducts(data || []));
  }, []);

  const loadStock = useCallback(async () => {
    if (!branchId) return;
    const { data } = await supabase.from('stock').select('product_id,qty').eq('branch_id', branchId).range(0, 4999);
    const m = {};
    (data || []).forEach((s) => (m[s.product_id] = Number(s.qty)));
    setStock(m);
  }, [branchId]);
  useEffect(() => { loadStock(); }, [loadStock]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = cat ? products.filter((p) => (p.category || '') === cat) : products;
    const list = t
      ? base.filter((p) => p.name.toLowerCase().includes(t) || (p.barcode || '').toLowerCase().includes(t) || (p.category || '').toLowerCase().includes(t))
      : base;
    return list.slice(0, 60);
  }, [products, q, cat]);
  const cats = useMemo(() => [...new Set(products.map((p) => (p.category || '').trim()).filter(Boolean))].sort(), [products]);

  // keep the product list clear of the cart that is fixed at the bottom on phones
  useEffect(() => {
    const el = cartRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const set = () => document.documentElement.style.setProperty('--cart-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--cart-h'); };
  });

  function add(p) {
    setCart((c) => {
      const i = c.findIndex((x) => x.id === p.id);
      if (i >= 0) return c.map((x, j) => (j === i ? { ...x, qty: Math.round((x.qty + stepFor(x.unit)) * 1000) / 1000, qs: undefined } : x));
      const unit = p.unit || 'pc';
      return [...c, { id: p.id, name: p.name, price: Number(p.price), qty: stepFor(unit) === 1 ? 1 : 1, unit, track: p.track_stock }];
    });
    setErr('');
  }

  function onSearchKey(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = q.trim();
    if (!t) return;
    const exact = products.find((p) => p.barcode && p.barcode === t);
    if (exact) { add(exact); setQ(''); return; }
    if (filtered.length === 1) { add(filtered[0]); setQ(''); return; }
    setErr(`No exact match for "${t}"`);
  }

  const setQty = (id, dir) =>
    setCart((c) => c.map((x) => (x.id === id ? { ...x, qty: Math.max(0, Math.round((x.qty + dir * stepFor(x.unit)) * 1000) / 1000), qs: undefined } : x)).filter((x) => x.qty > 0));
  // keeps what is typed as text so "0." and "0.5" can be entered
  const typeQty = (id, v) => {
    if (!/^\d*\.?\d{0,3}$/.test(v)) return;
    setCart((c) => c.map((x) => (x.id === id ? { ...x, qs: v, qty: Number(v) || 0 } : x)));
  };

  const sub = cart.reduce((s, c) => s + c.qty * c.price, 0);
  const disc = Math.min(Number(discount) || 0, sub);
  const rate = Number(business.tax_rate) || 0;
  const tax = Math.round((sub - disc) * rate) / 100;
  const total = sub - disc + tax;
  const isCash = method.toLowerCase() === 'cash';
  const paidNum = isCash ? Number(paid) || 0 : total;
  const change = isCash ? Math.max(0, paidNum - total) : 0;

  async function charge(withPrint) {
    const items = cart.filter((c) => c.qty > 0);
    if (!items.length) return setErr('Cart is empty');
    if (!branchId) return setErr('No branch assigned. Ask the owner to assign you to a branch.');
    if (isCash && paid !== '' && paidNum < total) return setErr('Amount paid is less than the total');
    setBusy(true);
    setErr('');
    const { data: id, error } = await supabase.rpc('create_sale', {
      p_branch: branchId,
      p_items: items.map((c) => ({ product_id: c.id, qty: c.qty })),
      p_payment: method,
      p_paid: isCash && paid === '' ? total : paidNum,
      p_discount: disc,
      p_note: '',
    });
    if (error) { setBusy(false); return setErr(error.message); }
    const { data: sale } = await supabase.from('sales').select('id,receipt_no,total,amount_paid').eq('id', id).single();
    setCart([]); setDiscount(''); setPaid(''); setQ('');
    loadStock();
    const info = { id, no: sale?.receipt_no, total: sale?.total, change: Math.max(0, Number(sale?.amount_paid || 0) - Number(sale?.total || 0)), url: '', failed: false };
    setFlash(info);
    if (withPrint) {
      const r = await post('/api/print/link', { sale_id: id, width: paperWidth() });
      if (r.ok) {
        setFlash({ ...info, url: r.data.url });
        window.location.href = schemeUrl(r.data.url);   // opens the Bluetooth Print app
      } else {
        setFlash({ ...info, failed: true });
      }
    }
    setBusy(false);
  }

  const lbl = (u) => (u && u !== 'pc' ? ` ${u}` : '');
  const cur = business.currency;

  if (!branchId) {
    return <div className="card"><h2>No branch assigned</h2><p>Ask the business owner to assign you to a branch in Staff.</p></div>;
  }

  return (
    <div className="pos no-print">
      <section>
        <div className="posbar">
          {cats.length > 0 && (
            <div className="chips" role="tablist" aria-label="Categories">
              <button className={!cat ? 'on' : ''} onClick={() => setCat('')}>All</button>
              {cats.map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(cat === c ? '' : c)}>{c}</button>)}
            </div>
          )}
          {!isCashier && branches.length > 1 && (
            <select className="input branch-pick" value={branchId} onChange={(e) => { setBranchId(e.target.value); setCart([]); }} aria-label="Branch">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button type="button" className="iconbtn" onClick={() => { setShowSearch((v) => !v); setTimeout(() => input.current?.focus(), 30); }} aria-label="Search" aria-expanded={showSearch}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          </button>
        </div>
        <div className={`searchrow ${showSearch ? 'open' : ''}`}>
          <input
            ref={input}
            className="input"
            placeholder={barcodeOn ? `Scan barcode or search ${label.toLowerCase()}...` : `Search ${label.toLowerCase()}...`}
            value={q}
            onChange={(e) => { setQ(e.target.value); setErr(''); }}
            onKeyDown={onSearchKey}
            aria-label="Scan or search"
          />
        </div>
        {err && <div className="err">{err}</div>}
        {products.length === 0 && (
          <div className="tint" style={{ marginTop: 12 }}>
            No {label.toLowerCase()}s yet. {profile.role === 'cashier' ? 'Ask your manager to add some.' : 'Open Products to add your first one.'}
          </div>
        )}
        <div className="tiles">
          {filtered.map((p) => {
            const s = stock[p.id] ?? 0;
            return (
              <button key={p.id} className="tile" onClick={() => add(p)}>
                <b>{p.name}</b>
                <span className="p">{money(p.price, cur)}{p.unit && p.unit !== 'pc' ? <span className="s"> / {p.unit}</span> : null}</span>
                {p.track_stock && <div className={`s ${s <= Number(p.low_stock_level) ? 'warn' : ''}`}>{num(s)}{lbl(p.unit)} in stock</div>}
              </button>
            );
          })}
        </div>
      </section>

      <aside className="card cart" ref={cartRef}>
        {cart.length === 0 && (
          flash ? (
            <div className="flashrow" role="status">
              <div><b>Sale #{flash.no} saved.</b> {money(flash.total, cur)}{flash.change > 0 ? `, change ${money(flash.change, cur)}` : ''}
                {flash.failed && <div className="err" style={{ margin: 0 }}>Could not prepare the printer link.</div>}</div>
              {mode !== 'never' && (flash.url
                ? <a className="btn small primary" href={schemeUrl(flash.url)} style={{ textDecoration: 'none' }}>Print again</a>
                : <button className="btn small" disabled={flash.failed} onClick={async () => { const r = await post('/api/print/link', { sale_id: flash.id, width: paperWidth() }); if (r.ok) { setFlash({ ...flash, url: r.data.url, failed: false }); window.location.href = schemeUrl(r.data.url); } else setFlash({ ...flash, failed: true }); }}>Print</button>)}
              <button className="btn small" onClick={() => setFlash(null)} aria-label="Dismiss">Close</button>
            </div>
          ) : <p className="muted cart-empty">Tap an item to start a sale.</p>
        )}

        {cart.length > 0 && (
          <>
            <div className="cart-lines">
              {cart.map((c) => (
                <div key={c.id} className="cart-line">
                  <div className="nm">
                    <b>{c.name}</b>
                    <div className="small muted">{money(c.price, cur)} per {c.unit && c.unit !== 'pc' ? c.unit : 'item'}</div>
                    {c.track && (stock[c.id] ?? 0) < c.qty && <div className="small warn">Only {num(stock[c.id] ?? 0)}{lbl(c.unit)} in stock</div>}
                  </div>
                  <div className="qty">
                    <button onClick={() => setQty(c.id, -1)} aria-label="Less">-</button>
                    <input className="input" inputMode="decimal" value={c.qs ?? c.qty} onChange={(e) => typeQty(c.id, e.target.value)} aria-label={`Quantity${c.unit && c.unit !== 'pc' ? ' in ' + c.unit : ''}`} />
                    <button onClick={() => setQty(c.id, 1)} aria-label="More">+</button>
                  </div>
                  <b className="lt">{money(c.qty * c.price, cur)}</b>
                </div>
              ))}
            </div>

            {methods.length > 1 && <div className="pay">
              {methods.map((m) => (
                <button key={m} className={`btn small ${m === method ? 'on' : ''}`} onClick={() => setMethod(m)}>{m}</button>
              ))}
            </div>}
            <div className="mini">
              {isCash && (
                <label>
                  <span>Cash received</span>
                  <input className="input" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder={String(total)} />
                </label>
              )}
              <label>
                <span>Discount</span>
                <input className="input" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
              </label>
            </div>
            {(disc > 0 || tax > 0 || (isCash && paid !== '' && paidNum >= total)) && (
              <div className="small muted sumline">
                {disc > 0 && <span>Discount -{money(disc, cur)}</span>}
                {tax > 0 && <span>Tax ({rate}%) {money(tax, cur)}</span>}
                {isCash && paid !== '' && paidNum >= total && <span className="ok">Change {money(change, cur)}</span>}
              </div>
            )}
            <div className="chargerow">
              {mode === 'ask' && <button className="btn" onClick={() => charge(false)} disabled={busy}>Charge</button>}
              <button className="btn primary grow" onClick={() => charge(mode !== 'never')} disabled={busy}>
                {busy ? 'Saving...' : `${mode === 'never' ? 'Charge' : 'Charge and print'}  ${money(total, cur)}`}
              </button>
              <button className="btn small clearbtn" onClick={() => { setCart([]); setDiscount(''); setPaid(''); }} aria-label="Clear sale">Clear</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
