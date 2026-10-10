'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import InstallApp from '@/components/InstallApp';
import { TYPE_PRESETS, slug } from '@/lib/util';

function Categories({ businessId }) {
  const [rows, setRows] = useState([]);
  const [name, setName] = useState('');
  const [edit, setEdit] = useState(null);       // { id, old, name }
  const [del, setDel] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const { data } = await supabase.from('categories').select('*').order('name').range(0, 999);
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const dup = (n, id) => rows.some((r) => r.id !== id && r.name.toLowerCase() === n.toLowerCase());

  async function add() {
    const n = name.trim();
    if (!n) return;
    setErr('');
    if (dup(n)) return setErr('That category already exists');
    const { error } = await supabase.from('categories').insert({ business_id: businessId, name: n.slice(0, 60) });
    if (error) return setErr(error.message);
    setName(''); load();
  }
  async function rename() {
    const n = edit.name.trim();
    if (!n) return;
    setErr('');
    if (dup(n, edit.id)) return setErr('That category already exists');
    const { error } = await supabase.from('categories').update({ name: n.slice(0, 60) }).eq('id', edit.id);
    if (error) return setErr(error.message);
    await supabase.from('products').update({ category: n.slice(0, 60) }).eq('category', edit.old);   // items follow the new name
    setEdit(null); load();
  }
  async function remove(r) {
    setErr('');
    await supabase.from('products').update({ category: '' }).eq('category', r.name);
    const { error } = await supabase.from('categories').delete().eq('id', r.id);
    if (error) return setErr(error.message);
    setDel(''); load();
  }
  const stop = (fn) => (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };

  return (
    <div className="card">
      <h3>Categories</h3>
      <p className="muted small">Group your items, for example Milk, Water, Cooking oil or Soft drinks. They appear as a list when you add or edit an item.</p>
      {rows.length === 0 && <p className="muted small">No categories yet.</p>}
      {rows.map((r) => (
        <div key={r.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
          {edit?.id === r.id ? (
            <>
              <input className="input grow" value={edit.name} maxLength={60} autoFocus onChange={(e) => setEdit({ ...edit, name: e.target.value })} onKeyDown={stop(rename)} aria-label="Category name" />
              <button type="button" className="btn small primary" onClick={rename}>Save</button>
              <button type="button" className="btn small" onClick={() => setEdit(null)}>Cancel</button>
            </>
          ) : (
            <>
              <b className="grow">{r.name}</b>
              <button type="button" className="btn small" onClick={() => { setEdit({ id: r.id, old: r.name, name: r.name }); setDel(''); }}>Rename</button>
              {del === r.id
                ? <button type="button" className="btn small danger" onClick={() => remove(r)}>Confirm delete</button>
                : <button type="button" className="btn small danger" onClick={() => setDel(r.id)}>Delete</button>}
            </>
          )}
        </div>
      ))}
      {del && <p className="muted small" style={{ marginTop: 8 }}>Items in this category are kept, they just become uncategorised.</p>}
      <div className="row" style={{ marginTop: 12 }}>
        <input className="input grow" placeholder="New category name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={stop(add)} aria-label="New category name" />
        <button type="button" className="btn primary" onClick={add}>Add category</button>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}

export default function Settings() {
  const { business, reload } = useAuth();
  const [f, setF] = useState({
    name: business.name,
    business_type: business.business_type || 'retail',
    item_label: business.item_label || 'Product',
    currency: business.currency || 'KES',
    tax_rate: business.tax_rate ?? 0,
    receipt_header: business.receipt_header || '',
    receipt_footer: business.receipt_footer || '',
    receipt_mode: business.receipt_mode || 'always',
    barcode_enabled: business.barcode_enabled !== false,
    payment_methods: (business.payment_methods || []).join(', '),
    credit_enabled: !!business.credit_enabled,
    credit_limit: business.credit_limit ?? 5000,
  });
  const [fields, setFields] = useState(business.custom_fields || []);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function applyPreset(k) {
    const p = TYPE_PRESETS[k];
    setF({ ...f, business_type: k, item_label: p.item_label });
    setFields(p.custom_fields);
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setMsg('');
    const methods = f.payment_methods.split(',').map((s) => s.trim()).filter(Boolean);
    if (!methods.length) { setBusy(false); return setErr('Add at least one payment method'); }
    const cleaned = fields.filter((x) => x.label.trim()).map((x) => ({ key: x.key || slug(x.label), label: x.label.trim(), type: x.type }));
    const { error } = await supabase.from('businesses').update({
      name: f.name.trim(), business_type: f.business_type, item_label: f.item_label.trim() || 'Product',
      currency: f.currency.trim() || 'KES', tax_rate: Number(f.tax_rate) || 0,
      receipt_header: f.receipt_header, receipt_footer: f.receipt_footer,
      receipt_mode: f.receipt_mode, barcode_enabled: !!f.barcode_enabled,
      payment_methods: methods, custom_fields: cleaned,
      credit_enabled: !!f.credit_enabled, credit_limit: Math.max(0, Number(f.credit_limit) || 0),
    }).eq('id', business.id);
    setBusy(false);
    if (error) return setErr(error.message);
    await reload();
    setMsg('Saved.');
  }

  return (
    <form onSubmit={save} style={{ maxWidth: 720 }}>
      <h1>Settings</h1>
      <p className="muted">Make Uzaa fit your business. Changes apply immediately to every screen and receipt.</p>

      <div className="card">
        <h3>Business</h3>
        <label className="field"><span>Business name</span><input className="input" required value={f.name} onChange={set('name')} /></label>
        <label className="field"><span>Start from a business type (replaces the labels and fields below)</span>
          <select className="input" value={f.business_type} onChange={(e) => applyPreset(e.target.value)}>
            {Object.entries(TYPE_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="field"><span>What do you sell? (shown as the item name)</span><input className="input" value={f.item_label} onChange={set('item_label')} placeholder="Product, Menu item, Service..." /></label>
        <div className="row">
          <label className="field grow"><span>Currency</span><input className="input" value={f.currency} onChange={set('currency')} /></label>
          <label className="field grow"><span>Tax rate (%)</span><input className="input" inputMode="decimal" value={f.tax_rate} onChange={set('tax_rate')} /></label>
        </div>
        <label className="field"><span>Payment methods (separate with commas)</span><input className="input" value={f.payment_methods} onChange={set('payment_methods')} /></label>
      </div>

      <div className="card">
        <h3>Extra product fields</h3>
        <p className="muted small">For example Expiry date for a pharmacy, Size for clothes, Unit for hardware.</p>
        {fields.map((x, i) => (
          <div className="row" key={i} style={{ marginBottom: 8 }}>
            <input className="input grow" placeholder="Field name" value={x.label} onChange={(e) => setFields(fields.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
            <select className="input" style={{ width: 130 }} value={x.type} onChange={(e) => setFields(fields.map((y, j) => (j === i ? { ...y, type: e.target.value } : y)))}>
              <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option>
            </select>
            <button type="button" className="btn small danger" onClick={() => setFields(fields.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn small" onClick={() => setFields([...fields, { key: '', label: '', type: 'text' }])}>Add a field</button>
      </div>

      <Categories businessId={business.id} />

      <div className="card">
        <h3>Barcodes</h3>
        <label className="row" style={{ marginBottom: 6 }}>
          <input type="checkbox" checked={f.barcode_enabled} onChange={(e) => setF({ ...f, barcode_enabled: e.target.checked })} /> My business uses barcodes
        </label>
        <p className="muted small" style={{ margin: 0 }}>Turn this off if you never scan. The barcode box and scan prompt are hidden; you still search by name. Barcodes you already saved are kept.</p>
      </div>

      <div className="card">
        <h3>Credit sales (deni)</h3>
        <label className="row" style={{ marginBottom: 6 }}>
          <input type="checkbox" checked={f.credit_enabled} onChange={(e) => setF({ ...f, credit_enabled: e.target.checked })} /> Let my customers take goods on credit
        </label>
        <p className="muted small" style={{ marginTop: 0 }}>
          Credit appears as a payment method at the till. The sale is saved and stock goes down as usual, but it stays
          unpaid and is recorded against the customer. You keep the list of who owes what under Credit.
        </p>
        {f.credit_enabled && (
          <>
            <label className="field" style={{ maxWidth: 280 }}><span>Most one customer may owe ({f.currency})</span>
              <input className="input" inputMode="decimal" value={f.credit_limit} onChange={set('credit_limit')} />
            </label>
            <p className="muted small" style={{ margin: 0 }}>
              A cashier cannot sell on credit past this amount. Put 0 for no limit. You can set a different limit for
              one customer on their own page.
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h3>Receipts</h3>
        <label className="field"><span>After each sale</span>
          <select className="input" value={f.receipt_mode} onChange={set('receipt_mode')}>
            <option value="always">Always show the receipt and print options</option>
            <option value="ask">Ask me each time (Print receipt or No receipt)</option>
            <option value="never">Never print: just save the sale</option>
          </select>
        </label>
        <p className="muted small">Every sale is saved either way. You can always find it under Sales, print it later, or download all sales as an Excel file from the Sales screen.</p>
        <label className="field"><span>Header (address, PIN, phone)</span><textarea className="input" value={f.receipt_header} onChange={set('receipt_header')} /></label>
        <label className="field"><span>Footer message</span><textarea className="input" value={f.receipt_footer} onChange={set('receipt_footer')} /></label>
      </div>

      <div className="card">
        <h3>Install Uzaa on a phone or tablet</h3>
        <p className="small muted" style={{ marginTop: 0 }}>Installed, Uzaa opens full screen from the home screen and starts faster. There is nothing to download from Google Play.</p>
        <ol className="small" style={{ paddingLeft: 20, margin: '0 0 10px' }}>
          <li><b>Android:</b> open uzaa.co.ke in Chrome, tap the three-dot menu, then <b>Install app</b> (sometimes called "Add to Home screen").</li>
          <li><b>iPhone or iPad:</b> open uzaa.co.ke in Safari, tap the Share button, then <b>Add to Home Screen</b>.</li>
          <li><b>Computer:</b> in Chrome or Edge, click the install icon at the right of the address bar.</li>
        </ol>
        <InstallApp className="btn primary">Install on this device</InstallApp>
      </div>

      <div className="card">
        <h3>Receipt printer (Xprinter and other Bluetooth or USB thermal printers)</h3>
        <ol className="small" style={{ paddingLeft: 20, margin: 0 }}>
          <li>On the Android phone or tablet, install the <b>Bluetooth Print</b> app from Google Play and pair your printer in it.</li>
          <li>In the app, turn on <b>Browser Print</b>.</li>
          <li>Open Uzaa in Chrome. After a sale, tap <b>Print to Bluetooth printer</b>. Choose 58 mm or 80 mm paper to match your roll.</li>
        </ol>
      </div>

      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}
      <button className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Save settings'}</button>
    </form>
  );
}
