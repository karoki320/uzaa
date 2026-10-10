'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { money, num, stepFor } from '@/lib/util';
import { post } from '@/lib/api';
import { paperWidth, schemeUrl } from '@/lib/printclient';
import { saveKv, getKv, strip, queueSale, nextLocalNo } from '@/lib/offline';
import { syncQueue, isNetwork } from '@/lib/sync';
import Modal from '@/components/Modal';

export default function POS() {
  const { profile, business, branches, session } = useAuth();
  const isCashier = profile.role === 'cashier';
  const [branchId, setBranchId] = useState(profile.branch_id || branches[0]?.id || '');
  const [products, setProducts] = useState([]);
  const [stock, setStock] = useState({});
  const [q, setQ] = useState('');
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState('');
  const baseMethods = business.payment_methods?.length ? business.payment_methods : ['Cash'];
  const creditOn = !!business.credit_enabled;
  const methods = creditOn && !baseMethods.some((m) => m.toLowerCase() === 'credit') ? [...baseMethods, 'Credit'] : baseMethods;
  const [method, setMethod] = useState(methods[0]);
  const [paid, setPaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cat, setCat] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const cartRef = useRef(null);
  const [flash, setFlash] = useState(null);
  const [online, setOnline] = useState(true);
  const [ref, setRef] = useState('');
  const [fromCopy, setFromCopy] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [pick, setPick] = useState(false);
  const input = useRef(null);
  const mode = business.receipt_mode || 'always';
  const barcodeOn = business.barcode_enabled !== false;
  const label = business.item_label || 'Product';

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // shop copy: show the saved one at once (the till opens instantly, even on a weak signal),
  // then replace it with fresh data from the server when that arrives
  const loadProducts = useCallback(async () => {
    const saved = await getKv('products');
    if (saved) { setProducts((cur) => (cur.length ? cur : saved)); setFromCopy(true); }
    if (!navigator.onLine) return;
    const { data, error } = await supabase.from('products').select('*').eq('active', true).order('name').range(0, 4999);
    if (!error && data) { setProducts(data); setFromCopy(false); saveKv('products', data.map(strip)); }
  }, []);
  useEffect(() => { loadProducts(); }, [loadProducts]);

  const loadStock = useCallback(async () => {
    if (!branchId) return;
    const saved = await getKv(`stock:${branchId}`);
    if (saved) setStock((cur) => (Object.keys(cur).length ? cur : saved));
    if (!navigator.onLine) return;
    const { data, error } = await supabase.from('stock').select('product_id,qty').eq('branch_id', branchId).range(0, 4999);
    if (!error && data) {
      const m = {};
      data.forEach((x) => (m[x.product_id] = Number(x.qty)));
      setStock(m);
      saveKv(`stock:${branchId}`, m);
    }
  }, [branchId]);
  useEffect(() => { loadStock(); }, [loadStock]);
  // when the connection returns, refresh prices and stock
  useEffect(() => { if (online) { loadProducts(); loadStock(); } }, [online]); // eslint-disable-line
  useEffect(() => {
    const f = () => { loadProducts(); loadStock(); };
    window.addEventListener('uzaa-synced', f);
    return () => window.removeEventListener('uzaa-synced', f);
  }, [loadProducts, loadStock]);

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
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--cart-h', `${el.offsetHeight}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--cart-h'); };
  }, []);

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
  const isCredit = method.toLowerCase() === 'credit';
  const paidNum = isCredit ? Math.min(Number(paid) || 0, total) : isCash ? Number(paid) || 0 : total;
  const change = isCash ? Math.max(0, paidNum - total) : 0;

  // the list of people who may take goods on credit, loaded the first time it is needed
  useEffect(() => {
    if (!isCredit || customers.length) return;
    supabase.from('customer_debts').select('id,name,phone,balance,credit_limit').order('name').range(0, 999)
      .then(({ data }) => setCustomers(data || []));
  }, [isCredit]); // eslint-disable-line

  async function charge(withPrint) {
    const items = cart.filter((c) => c.qty > 0);
    if (!items.length) return setErr('Cart is empty');
    if (!branchId) return setErr('No branch assigned. Ask the owner to assign you to a branch.');
    if (isCash && paid !== '' && paidNum < total) return setErr('Amount paid is less than the total');
    const offlineNow = !navigator.onLine;
    if (isCredit) {
      if (!customer) return setErr('Choose who is taking this on credit');
      if (offlineNow) return setErr('Credit sales need a connection. Use another payment method, or wait for the network.');
    } else if (offlineNow && !isCash && ref.trim().length < 6) {
      return setErr(`No internet: type the ${method} code from the customer's message so it can be checked later`);
    }
    setBusy(true);
    setErr('');
    const sale = {
      id: crypto.randomUUID(),          // one id per sale: the server never records the same sale twice
      user_id: session?.user?.id,
      branch_id: branchId,
      items: items.map((c) => ({ id: c.id, name: c.name, qty: c.qty, price: c.price, unit: c.unit })),
      method,
      paid: isCredit ? paidNum : isCash && paid === '' ? total : paidNum,
      discount: disc,
      note: !isCash && !isCredit && ref.trim() ? `${method} code ${ref.trim().slice(0, 40)}` : '',
      customer_id: customer?.id || null,
      total,
      at: new Date().toISOString(),
      status: 'queued',
    };
    const finish = () => { setCart([]); setDiscount(''); setPaid(''); setQ(''); setRef(''); setCustomer(null); };

    // keep it on the phone: no signal, or the request failed on the way
    const keep = async () => {
      sale.local_no = await nextLocalNo();
      try { await queueSale(sale); } catch { setBusy(false); return setErr('Could not save on this phone. Free some storage and try again.'); }
      setStock((m) => {
        const n = { ...m };
        items.forEach((c) => { if (c.track) n[c.id] = Math.round(((n[c.id] ?? 0) - c.qty) * 1000) / 1000; });
        saveKv(`stock:${branchId}`, n);
        return n;
      });
      finish();
      setFlash({ queued: true, no: sale.local_no, total, change: Math.max(0, sale.paid - total) });
      setBusy(false);
    };
    if (offlineNow) return keep();

    const { data: id, error, status } = await supabase.rpc('create_sale', {
      p_branch: branchId,
      p_items: items.map((c) => ({ product_id: c.id, qty: c.qty })),
      p_payment: method,
      p_paid: sale.paid,
      p_discount: disc,
      p_note: sale.note,
      p_client_id: sale.id,
      p_customer: sale.customer_id,
    });
    if (error) {
      if (isNetwork(error, status) || status === 401) { sale.offlineTried = true; return keep(); }   // the sale may or may not have arrived; the id makes a re-send safe
      setBusy(false);
      return setErr(error.message);
    }
    const { data: row } = await supabase.from('sales').select('id,receipt_no,total,amount_paid').eq('id', id).single();
    finish();
    loadStock();
    syncQueue(session?.user?.id);   // also send anything that was waiting
    const info = { id, no: row?.receipt_no, total: row?.total, change: Math.max(0, Number(row?.amount_paid || 0) - Number(row?.total || 0)), url: '', failed: false };
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
        {!isCashier && branches.length > 1 && (
          <select className="input branch-pick" value={branchId} onChange={(e) => { setBranchId(e.target.value); setCart([]); }} aria-label="Branch">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <div className="posbar">
          <div className="chips" role="tablist" aria-label="Categories">
            <button className={!cat ? 'on' : ''} onClick={() => setCat('')}>All</button>
            {cats.map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(cat === c ? '' : c)}>{c}</button>)}
          </div>
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
        {(!online || fromCopy) && <div className="tint offlinebar" role="status">Offline. Sales are saved on this phone and upload when you are back online. Prices and stock are from your last connection.</div>}
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
            flash.queued ? (
              <div className="flashrow" role="status">
                <div><b>Sale {flash.no} saved on this phone.</b> {money(flash.total, cur)}{flash.change > 0 ? `, change ${money(flash.change, cur)}` : ''}
                  <div className="small muted">It uploads by itself when you are online. Print it from Sales after that.</div></div>
                <button className="btn small" onClick={() => setFlash(null)} aria-label="Dismiss">Close</button>
              </div>
            ) : (
            <div className="flashrow" role="status">
              <div><b>Sale #{flash.no} saved.</b> {money(flash.total, cur)}{flash.change > 0 ? `, change ${money(flash.change, cur)}` : ''}
                {flash.failed && <div className="err" style={{ margin: 0 }}>Could not prepare the printer link.</div>}</div>
              {mode !== 'never' && (flash.url
                ? <a className="btn small primary" href={schemeUrl(flash.url)} style={{ textDecoration: 'none' }}>Print again</a>
                : <button className="btn small" disabled={flash.failed} onClick={async () => { const r = await post('/api/print/link', { sale_id: flash.id, width: paperWidth() }); if (r.ok) { setFlash({ ...flash, url: r.data.url, failed: false }); window.location.href = schemeUrl(r.data.url); } else setFlash({ ...flash, failed: true }); }}>Print</button>)}
              <button className="btn small" onClick={() => setFlash(null)} aria-label="Dismiss">Close</button>
            </div>)
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
            {isCredit && (
              <div className="creditrow">
                <button type="button" className="btn small grow" onClick={() => setPick(true)}>
                  {customer ? `On credit: ${customer.name}` : 'Choose the customer'}
                </button>
                {customer && Number(customer.balance) > 0 && (
                  <span className="small muted">owes {money(customer.balance, cur)}</span>
                )}
              </div>
            )}
            {!online && !isCash && !isCredit && (
              <div className="mini"><label><span>{method} code (required offline)</span>
                <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. SJK4H2L9QP" autoCapitalize="characters" /></label></div>
            )}
            <div className="mini">
              {(isCash || isCredit) && (
                <label>
                  <span>{isCredit ? 'Deposit now (optional)' : 'Cash received'}</span>
                  <input className="input" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder={isCredit ? '0' : String(total)} />
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
              {mode === 'ask' && online && <button className="btn" onClick={() => charge(false)} disabled={busy}>Charge</button>}
              <button className="btn primary grow" onClick={() => charge(mode !== 'never' && online)} disabled={busy}>
                {busy ? 'Saving...' : `${isCredit ? 'Give on credit' : mode === 'never' || !online ? 'Charge' : 'Charge and print'}  ${money(total, cur)}`}
              </button>
              <button className="btn small clearbtn" onClick={() => { setCart([]); setDiscount(''); setPaid(''); }} aria-label="Clear sale">Clear</button>
            </div>
          </>
        )}
      </aside>

      {pick && (
        <CustomerPick
          rows={customers} cur={cur} businessId={business.id}
          onClose={() => setPick(false)}
          onPick={(c) => { setCustomer(c); setPick(false); setErr(''); }}
          onAdded={(c) => { setCustomers((l) => [...l, c]); setCustomer(c); setPick(false); setErr(''); }}
        />
      )}
    </div>
  );
}

// Pick who is taking the goods, or save a new person without leaving the till.
function CustomerPick({ rows, cur, businessId, onClose, onPick, onAdded }) {
  const [t, setT] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const term = t.trim().toLowerCase();
  const found = term ? rows.filter((r) => r.name.toLowerCase().includes(term) || (r.phone || '').includes(term)) : rows;

  async function create() {
    const name = t.trim();
    if (!name) return setErr('Type the name first');
    setBusy(true); setErr('');
    const { data, error } = await supabase.from('customers')
      .insert({ business_id: businessId, name: name.slice(0, 80), phone: phone.trim().slice(0, 20) })
      .select('id,name,phone').single();
    setBusy(false);
    if (error) return setErr(/duplicate|unique/i.test(error.message) ? 'That number is already saved for another customer' : error.message);
    onAdded({ ...data, balance: 0 });
  }

  return (
    <Modal title="Who is taking this?" onClose={onClose}>
      <input className="input" autoFocus placeholder="Search or type a new name" value={t} onChange={(e) => { setT(e.target.value); setErr(''); }} aria-label="Customer name" />
      <div style={{ maxHeight: '38vh', overflowY: 'auto', margin: '10px 0' }}>
        {found.map((r) => (
          <button key={r.id} className="debtrow" onClick={() => onPick(r)}>
            <div><b>{r.name}</b><div className="small muted">{r.phone || 'No number'}</div></div>
            <div className={`amt ${Number(r.balance) > 0 ? 'owing' : 'clear'}`}>{Number(r.balance) > 0 ? money(r.balance, cur) : 'Cleared'}</div>
          </button>
        ))}
        {found.length === 0 && <p className="muted small">Nobody by that name yet.</p>}
      </div>
      {t.trim() && !found.some((r) => r.name.toLowerCase() === term) && (
        <div className="tint">
          <b className="small">New customer: {t.trim()}</b>
          <label className="field" style={{ margin: '8px 0' }}><span>Phone number (for reminders)</span>
            <input className="input" inputMode="tel" placeholder="0722 000 111" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={create}>{busy ? 'Saving...' : 'Save and use'}</button>
        </div>
      )}
      {err && <div className="err">{err}</div>}
    </Modal>
  );
}
