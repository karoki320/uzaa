'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/util';
import Modal from '@/components/Modal';

const blank = { name: '', barcode: '', category: '', price: '', cost: '', track_stock: true, low_stock_level: 5, custom: {}, opening: '' };

export default function Products() {
  const { business, branches, profile } = useAuth();
  const label = business.item_label || 'Product';
  const fields = business.custom_fields || [];
  const [rows, setRows] = useState([]);
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

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((p) => p.name.toLowerCase().includes(t) || (p.barcode || '').includes(t) || (p.category || '').toLowerCase().includes(t)) : rows;
  }, [rows, q]);

  async function save(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    const payload = {
      name: edit.name.trim(),
      barcode: edit.barcode?.trim() || null,
      category: edit.category?.trim() || '',
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
    load();
  }

  async function toggle(p) {
    await supabase.from('products').update({ active: !p.active }).eq('id', p.id);
    load();
  }

  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setCustom = (k) => (e) => setEdit({ ...edit, custom: { ...edit.custom, [k]: e.target.value } });

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div><h1>{label}s</h1><div className="muted small">{rows.length} in catalogue</div></div>
        <button className="btn primary" onClick={() => setEdit({ ...blank })}>Add {label.toLowerCase()}</button>
      </div>
      <input className="input" placeholder="Search by name, barcode or category" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Barcode</th><th>Category</th><th className="num">Price</th><th className="num">Cost</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id}>
                <td><b>{p.name}</b></td>
                <td>{p.barcode || '-'}</td>
                <td>{p.category || '-'}</td>
                <td className="num">{money(p.price, business.currency)}</td>
                <td className="num">{money(p.cost, business.currency)}</td>
                <td>{p.active ? <span className="badge">Active</span> : <span className="badge red">Hidden</span>}</td>
                <td className="right">
                  <button className="btn small" onClick={() => setEdit({ ...p, price: p.price, cost: p.cost, custom: p.custom || {}, opening: '' })}>Edit</button>{' '}
                  <button className="btn small" onClick={() => toggle(p)}>{p.active ? 'Hide' : 'Show'}</button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan="7" className="muted">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={edit.id ? `Edit ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`} onClose={() => setEdit(null)}>
          <form onSubmit={save}>
            <label className="field"><span>Name</span><input className="input" required value={edit.name} onChange={set('name')} /></label>
            <label className="field"><span>Barcode (scan it here)</span><input className="input" value={edit.barcode || ''} onChange={set('barcode')} /></label>
            <label className="field"><span>Category</span><input className="input" value={edit.category || ''} onChange={set('category')} /></label>
            <div className="row">
              <label className="field grow"><span>Selling price</span><input className="input" required inputMode="decimal" value={edit.price} onChange={set('price')} /></label>
              <label className="field grow"><span>Cost price</span><input className="input" inputMode="decimal" value={edit.cost} onChange={set('cost')} /></label>
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
