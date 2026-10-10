'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { money, UNITS } from '@/lib/util';
import Modal from '@/components/Modal';

const blank = { name: '', barcode: '', category: '', unit: 'pc', price: '', cost: '', track_stock: true, low_stock_level: 5, custom: {}, opening: '' };

export default function Products() {
  const { business, branches, profile } = useAuth();
  const label = business.item_label || 'Product';
  const fields = business.custom_fields || [];
  const [rows, setRows] = useState([]);
  const [cats, setCats] = useState([]);
  const [newCat, setNewCat] = useState('');
  const barcodeOn = business.barcode_enabled !== false;
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [branchId, setBranchId] = useState(profile.branch_id || branches[0]?.id);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('products').select('*').order('name').range(0, 4999);
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const loadCats = useCallback(async () => {
    const { data } = await supabase.from('categories').select('*').order('name').range(0, 999);
    setCats(data || []);
  }, []);
  useEffect(() => { loadCats(); }, [loadCats]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((p) => p.name.toLowerCase().includes(t) || (p.barcode || '').includes(t) || (p.category || '').toLowerCase().includes(t)) : rows;
  }, [rows, q]);

  async function save(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    let category = (edit.category || '').trim();
    if (category === '__new') {
      category = newCat.trim().slice(0, 60);
      if (category && !cats.some((c) => c.name.toLowerCase() === category.toLowerCase())) {
        const { error: ce } = await supabase.from('categories').insert({ business_id: business.id, name: category });
        if (ce && !ce.message.includes('categories_biz_name')) { setBusy(false); return setErr(ce.message); }
      }
      loadCats();
    }
    const unit = (edit.unit || 'pc').trim().toLowerCase().slice(0, 20) || 'pc';
    const payload = {
      name: edit.name.trim(),
      barcode: barcodeOn ? edit.barcode?.trim() || null : edit.barcode?.trim() || null,
      category,
      unit,
      price: Number(edit.price) || 0,
      cost: Number(edit.cost) || 0,
      track_stock: !!edit.track_stock,
      low_stock_level: Number(edit.low_stock_level) || 0,
      custom: edit.custom || {},
    };
    let error;
    if (edit.id) {
      ({ error } = await supabase.from('products').update(payload).eq('id', edit.id));
    } else {
      const res = await supabase.from('products').insert({ ...payload, business_id: business.id }).select('id').single();
      error = res.error;
      if (!error && payload.track_stock && Number(edit.opening) > 0) {
        const r2 = await supabase.rpc('adjust_stock', { p_product: res.data.id, p_branch: branchId, p_change: Number(edit.opening), p_reason: 'Opening stock' });
        error = r2.error;
      }
    }
    setBusy(false);
    if (error) return setErr(error.message.includes('products_barcode_uq') ? 'That barcode is already used by another item' : error.message);
    setEdit(null);
    setNewCat('');
    load();
  }

  async function toggle(p) {
    await supabase.from('products').update({ active: !p.active }).eq('id', p.id);
    load();
  }

  const unitName = edit?.unit || 'unit';
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setCustom = (k) => (e) => setEdit({ ...edit, custom: { ...edit.custom, [k]: e.target.value } });

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div><h1>{label}s</h1><div className="muted small">{rows.length} in catalogue</div></div>
        <button className="btn primary" onClick={() => setEdit({ ...blank })}>Add {label.toLowerCase()}</button>
      </div>
      <input className="input" placeholder={barcodeOn ? 'Search by name, barcode or category' : 'Search by name or category'} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Name</th>{barcodeOn && <th>Barcode</th>}<th>Category</th><th className="num">Price</th><th className="num">Cost</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id}>
                <td><b>{p.name}</b></td>
                {barcodeOn && <td>{p.barcode || '-'}</td>}
                <td>{p.category || '-'}</td>
                <td className="num">{money(p.price, business.currency)}<span className="muted small"> / {p.unit || 'pc'}</span></td>
                <td className="num">{money(p.cost, business.currency)}</td>
                <td>{p.active ? <span className="badge">Active</span> : <span className="badge red">Hidden</span>}</td>
                <td className="right">
                  <button className="btn small" onClick={() => setEdit({ ...p, price: p.price, cost: p.cost, custom: p.custom || {}, opening: '' })}>Edit</button>{' '}
                  <button className="btn small" onClick={() => toggle(p)}>{p.active ? 'Hide' : 'Show'}</button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan="8" className="muted">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={edit.id ? `Edit ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`} onClose={() => setEdit(null)}>
          <form onSubmit={save}>
            <label className="field"><span>Name</span><input className="input" required value={edit.name} onChange={set('name')} /></label>
            {barcodeOn && <label className="field"><span>Barcode (scan it here)</span><input className="input" value={edit.barcode || ''} onChange={set('barcode')} /></label>}
            <div className="row">
              <label className="field grow"><span>Category</span>
                <select className="input" value={edit.category || ''} onChange={set('category')}>
                  <option value="">No category</option>
                  {edit.category && edit.category !== '__new' && !cats.some((c) => c.name === edit.category) && <option value={edit.category}>{edit.category}</option>}
                  {cats.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                  <option value="__new">+ New category...</option>
                </select>
              </label>
              <label className="field grow"><span>Sold by (unit)</span>
                <select className="input" value={UNITS.some((u) => u[0] === edit.unit) ? edit.unit : '__custom'} onChange={(e) => setEdit({ ...edit, unit: e.target.value === '__custom' ? '' : e.target.value })}>
                  {UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  <option value="__custom">Other...</option>
                </select>
              </label>
            </div>
            {edit.category === '__new' && (
              <label className="field"><span>New category name</span><input className="input" required maxLength={60} value={newCat} onChange={(e) => setNewCat(e.target.value)} /></label>
            )}
            {!UNITS.some((u) => u[0] === edit.unit) && (
              <label className="field"><span>Custom unit (for example tray, sachet, roll)</span><input className="input" required maxLength={20} value={edit.unit || ''} onChange={set('unit')} /></label>
            )}
            <div className="row">
              <label className="field grow"><span>Selling price (per {unitName})</span><input className="input" required inputMode="decimal" value={edit.price} onChange={set('price')} /></label>
              <label className="field grow"><span>Cost price (per {unitName})</span><input className="input" inputMode="decimal" value={edit.cost} onChange={set('cost')} /></label>
            </div>
            {fields.map((f) => (
              <label className="field" key={f.key}>
                <span>{f.label}</span>
                <input className="input" type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={edit.custom?.[f.key] || ''} onChange={setCustom(f.key)} />
              </label>
            ))}
            <label className="row" style={{ marginBottom: 14 }}>
              <input type="checkbox" checked={!!edit.track_stock} onChange={set('track_stock')} /> Track stock for this {label.toLowerCase()}
            </label>
            {edit.track_stock && (
              <div className="row">
                <label className="field grow"><span>Low stock warning at</span><input className="input" inputMode="decimal" value={edit.low_stock_level} onChange={set('low_stock_level')} /></label>
                {!edit.id && (
                  <label className="field grow"><span>Opening stock</span><input className="input" inputMode="decimal" value={edit.opening} onChange={set('opening')} /></label>
                )}
              </div>
            )}
            {!edit.id && edit.track_stock && branches.length > 1 && (
              <label className="field"><span>Opening stock goes to</span>
                <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
            {err && <div className="err">{err}</div>}
            <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
          </form>
        </Modal>
      )}
    </>
  );
}
