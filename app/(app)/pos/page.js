'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { money, num } from '@/lib/util';
import Modal from '@/components/Modal';
import Receipt from '@/components/Receipt';
import PrintButtons from '@/components/PrintButtons';

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
  const [done, setDone] = useState(null);
  const [auto, setAuto] = useState(false);
  const input = useRef(null);
  const label = business.item_label || 'Product';

  useEffect(() => {
    try { setAuto(localStorage.getItem('uzaa_autoprint') === '1'); } catch {}
  }, []);

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
    const list = t
      ? products.filter((p) => p.name.toLowerCase().includes(t) || (p.barcode || '').toLowerCase().includes(t) || (p.category || '').toLowerCase().includes(t))
      : products;
    return list.slice(0, 60);
  }, [products, q]);

  function add(p) {
    setCart((c) => {
      const i = c.findIndex((x) => x.id === p.id);
      if (i >= 0) return c.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x));
      return [...c, { id: p.id, name: p.name, price: Number(p.price), qty: 1, track: p.track_stock }];
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

  const setQty = (id, d) =>
    setCart((c) => c.map((x) => (x.id === id ? { ...x, qty: Math.max(0, x.qty + d) } : x)).filter((x) => x.qty > 0));
  const typeQty = (id, v) =>
    setCart((c) => c.map((x) => (x.id === id ? { ...x, qty: Math.max(0, Number(v) || 0) } : x)));

  const sub = cart.reduce((s, c) => s + c.qty * c.price, 0);
  const disc = Math.min(Number(discount) || 0, sub);
  const rate = Number(business.tax_rate) || 0;
  const tax = Math.round((sub - disc) * rate) / 100;
  const total = sub - disc + tax;
  const isCash = method.toLowerCase() === 'cash';
  const paidNum = isCash ? Number(paid) || 0 : total;
  const change = isCash ? Math.max(0, paidNum - total) : 0;

  async function charge() {
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
    const { data: sale } = await supabase.from('sales').select('*').eq('id', id).single();
    setBusy(false);
    setDone({ sale, items: items.map((c) => ({ name: c.name, qty: c.qty, price: c.price })) });
    setCart([]); setDiscount(''); setPaid(''); setQ('');
    loadStock();
    if (auto) setTimeout(() => window.print(), 400);
  }

  function closeReceipt() {
    setDone(null);
    setTimeout(() => input.current?.focus(), 50);
  }

  const toggleAuto = (v) => {
    setAuto(v);
    try { localStorage.setItem('uzaa_autoprint', v ? '1' : '0'); } catch {}
  };

  if (!branchId) {
    return <div className="card"><h2>No branch assigned</h2><p>Ask the business owner to assign you to a branch in Staff.</p></div>;
  }

  const branch = branches.find((b) => b.id === branchId);

  return (
    <>
      <div className="pos no-print">
        <section>
          <div className="row">
            <input
              ref={input}
              autoFocus
              className="input grow"
              style={{ fontSize: 18 }}
              placeholder={`Scan barcode or search ${label.toLowerCase()}...`}
              value={q}
              onChange={(e) => { setQ(e.target.value); setErr(''); }}
              onKeyDown={onSearchKey}
              aria-label="Scan or search"
            />
            {!isCashier && branches.length > 1 && (
              <select className="input" style={{ width: 200 }} value={branchId} onChange={(e) => { setBranchId(e.target.value); setCart([]); }}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
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
                <button key={p.id} className="tile" onClick={() => { add(p); input.current?.focus(); }}>
                  <b>{p.name}</b>
                  <span className="p">{money(p.price, business.currency)}</span>
                  {p.track_stock && (
                    <div className={`s ${s <= Number(p.low_stock_level) ? 'warn' : ''}`}>{num(s)} in stock</div>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="card cart">
          <h2>Current sale</h2>
          {cart.length === 0 && <p className="muted">Scan or tap an item to start.</p>}
          {cart.map((c) => (
            <div key={c.id} className="cart-line">
              <div>
                <b>{c.name}</b>
                <div className="small muted">{money(c.price, business.currency)} each</div>
                {c.track && (stock[c.id] ?? 0) < c.qty && <div className="small warn">Only {num(stock[c.id] ?? 0)} in stock</div>}
              </div>
              <div className="right">
                <div className="qty">
                  <button onClick={() => setQty(c.id, -1)} aria-label="Less">-</button>
                  <input className="input" style={{ width: 64, textAlign: 'center' }} inputMode="decimal" value={c.qty} onChange={(e) => typeQty(c.id, e.target.value)} />
                  <button onClick={() => setQty(c.id, 1)} aria-label="More">+</button>
                </div>
                <div><b>{money(c.qty * c.price, business.currency)}</b></div>
              </div>
            </div>
          ))}

          {cart.length > 0 && (
            <>
              <label className="field" style={{ marginTop: 12 }}>
                <span>Discount ({business.currency})</span>
                <input className="input" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </label>
              <div className="totals">
                <div><span>Subtotal</span><span>{money(sub, business.currency)}</span></div>
                {disc > 0 && <div><span>Discount</span><span>-{money(disc, business.currency)}</span></div>}
                {tax > 0 && <div><span>Tax ({rate}%)</span><span>{money(tax, business.currency)}</span></div>}
                <div className="grand"><span>Total</span><span>{money(total, business.currency)}</span></div>
              </div>
              <div className="pay">
                {methods.map((m) => (
                  <button key={m} className={`btn ${m === method ? 'on' : ''}`} onClick={() => setMethod(m)}>{m}</button>
                ))}
              </div>
              {isCash && (
                <label className="field">
                  <span>Cash received</span>
                  <input className="input" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder={String(total)} />
                  {paid !== '' && paidNum >= total && <div className="ok" style={{ marginTop: 6 }}>Change: {money(change, business.currency)}</div>}
                </label>
              )}
              <button className="btn primary" style={{ width: '100%', fontSize: 18 }} onClick={charge} disabled={busy}>
                {busy ? 'Saving...' : `Charge ${money(total, business.currency)}`}
              </button>
              <button className="btn small" style={{ width: '100%', marginTop: 8 }} onClick={() => { setCart([]); setDiscount(''); setPaid(''); }}>Clear sale</button>
            </>
          )}
        </aside>
      </div>

      {done && (
        <Modal onClose={closeReceipt}>
          <Receipt business={business} branch={branch} sale={done.sale} items={done.items} cashier={profile.full_name} />
          <div className="no-print" style={{ marginTop: 16 }}>
            <label className="row small" style={{ marginBottom: 12 }}>
              <input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} /> Print receipt automatically after each sale
            </label>
            <PrintButtons saleId={done.sale.id} />
            <button className="btn primary" style={{ width: '100%', marginTop: 12 }} onClick={closeReceipt}>New sale</button>
          </div>
        </Modal>
      )}
    </>
  );
}
