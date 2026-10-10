'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { TYPE_PRESETS, slug } from '@/lib/util';

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
    payment_methods: (business.payment_methods || []).join(', '),
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
      payment_methods: methods, custom_fields: cleaned,
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

      <div className="card">
        <h3>Receipt</h3>
        <label className="field"><span>Header (address, PIN, phone)</span><textarea className="input" value={f.receipt_header} onChange={set('receipt_header')} /></label>
        <label className="field"><span>Footer message</span><textarea className="input" value={f.receipt_footer} onChange={set('receipt_footer')} /></label>
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
