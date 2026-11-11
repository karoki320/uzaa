'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { money, UNITS } from '@/lib/util';
import Modal from '@/components/Modal';
import CameraScanner from '@/components/CameraScanner';
import { findByBarcode } from '@/lib/barcode';
import { post } from '@/lib/api';

const PAGE = 100;   // a phone draws 100 rows quickly; hundreds at once make the page sluggish
const blank = { name: '', barcode: '', category: '', unit: 'pc', price: '', cost: '', track_stock: true, low_stock_level: 5, custom: {}, opening: '' };

export default function Products() {
  const { business, branches, profile } = useAuth();
  const label = business.item_label || 'Product';
  // cashiers see the list and, when the owner allows it, add new items. Only owner and managers change existing ones.
  const isCashier = profile.role === 'cashier';
  const canEdit = !isCashier;
  const canAdd = canEdit || business.cashier_add_products !== false;
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
  const [look, setLook] = useState(null);   // name lookup for a new barcode: { code, state, text }
  const [scan, setScan] = useState(null);   // 'find': look a product up, 'field': fill the barcode box
  const [limit, setLimit] = useState(PAGE);   // rows drawn on screen; search still covers everything
  useEffect(() => { setLimit(PAGE); }, [q]);

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

  // arriving from a scan of an unknown code (Stock page): open "Add" with the barcode filled in
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('barcode');
    if (!code) return;
    setEdit({ ...blank, barcode: code.slice(0, 64) });
    lookup(code.slice(0, 64));
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // a barcode only holds a number: ask the free Open Food Facts database for the product's name and size
  async function lookup(code) {
    const c = String(code || '').trim();
    if (!/^\d{8,14}$/.test(c)) return;
    setLook({ code: c, state: 'busy', text: 'Looking up the name...' });
    const r = await post('/api/barcode', { code: c });
    if (r.ok && r.data.found) {
      // fill the name only if it is still empty and the barcode has not changed meanwhile
      const d = r.data;
      const cat = d.category && cats.find((k) => k.name.toLowerCase() === d.category.toLowerCase());
      setEdit((x) => {
        if (!x || x.id || x.barcode?.trim() !== c || x.name.trim()) return x;
        return {
          ...x,
          name: d.name,
          // unit and category only when another shop used them and this form still has the defaults
          unit: d.unit && (x.unit || 'pc') === 'pc' ? d.unit : x.unit,
          category: cat && !x.category ? cat.name : x.category,
        };
      });
      setLook({ code: c, state: 'found', text: `Found (${d.source}): ${d.name}. Check it, then add your selling price.` });
    } else {
      setLook({ code: c, state: 'none', text: r.data?.error || (r.ok ? 'Not found in any product database yet. Type the name: the next Uzaa shop that scans it will get it filled in.' : 'Could not look the name up. Type it yourself.') });
    }
  }

  // scan a product: open it if it exists, otherwise start adding it with the barcode filled in
  function onFind(code) {
    const p = findByBarcode(rows, code);
    setScan(null);
    setErr('');
    if (p && !canEdit) { setQ(p.name); return { ok: true, text: `${p.name} is already in the list` }; }
    if (p) setEdit({ ...p, price: p.price, cost: p.cost, custom: p.custom || {}, opening: '' });
    else if (!canAdd) return { ok: false, text: 'Not in the list. Ask the owner or a manager to add it.' };
    else { setEdit({ ...blank, barcode: code }); lookup(code); }
    return { ok: true, text: p ? p.name : `New: ${code}` };
  }
  function onField(code) {
    const other = findByBarcode(rows, code);
    if (other && other.id !== edit?.id) return { ok: false, text: `${code} is already used by ${other.name}` };
    setEdit((x) => ({ ...x, barcode: code }));
    if (!edit?.id && !edit?.name?.trim()) lookup(code);
    setScan(null);
    return { ok: true, text: code };
  }

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
    let saved = null;
    if (edit.id) {
      const res = await supabase.from('products').update(payload).eq('id', edit.id).select('*').single();
      error = res.error;
      saved = res.data;
    } else {
      const res = await supabase.from('products').insert({ ...payload, business_id: business.id }).select('*').single();
      error = res.error;
      saved = res.data;
      if (!error && payload.track_stock && Number(edit.opening) > 0) {
        const r2 = await supabase.rpc('adjust_stock', { p_product: res.data.id, p_branch: isCashier ? profile.branch_id : branchId, p_change: Number(edit.opening), p_reason: 'Opening stock' });
        error = r2.error;
      }
    }
    setBusy(false);
    if (error) return setErr(error.message.includes('products_barcode_uq') ? 'That barcode is already used by another item' : /row-level security|Not allowed/i.test(error.message) ? 'You are not allowed to do that. Ask the owner to let cashiers add items (Settings > Staff permissions).' : error.message);
    setEdit(null);
    setNewCat('');
    // put the saved row straight into the list instead of downloading every product again
    if (saved) setRows((list) => (list.some((r) => r.id === saved.id) ? list.map((r) => (r.id === saved.id ? saved : r)) : [...list, saved]).sort((a, b) => a.name.localeCompare(b.name)));
    else load();
  }

  async function toggle(p) {
    setRows((list) => list.map((r) => (r.id === p.id ? { ...r, active: !p.active } : r)));   // show it at once
    const { error } = await supabase.from('products').update({ active: !p.active }).eq('id', p.id);
    if (error) load();
  }

  const unitName = edit?.unit || 'unit';
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setCustom = (k) => (e) => setEdit({ ...edit, custom: { ...edit.custom, [k]: e.target.value } });

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div><h1>{label}s</h1><div className="muted small">{rows.length} in catalogue</div></div>
        <div className="row" style={{ gap: 8 }}>
          {barcodeOn && <button className="btn" onClick={() => setScan('find')}>Scan</button>}
          {canAdd && <button className="btn primary" onClick={() => setEdit({ ...blank })}>Add {label.toLowerCase()}</button>}
        </div>
      </div>
      <input className="input" placeholder={barcodeOn ? 'Search by name, barcode or category' : 'Search by name or category'} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Name</th>{barcodeOn && <th>Barcode</th>}<th>Category</th><th className="num">Price</th>{canEdit && <th className="num">Cost</th>}<th>Status</th>{canEdit && <th></th>}</tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((p) => (
              <tr key={p.id}>
                <td><b>{p.name}</b></td>
                {barcodeOn && <td>{p.barcode || '-'}</td>}
                <td>{p.category || '-'}</td>
                <td className="num">{money(p.price, business.currency)}<span className="muted small"> / {p.unit || 'pc'}</span></td>
                {canEdit && <td className="num">{money(p.cost, business.currency)}</td>}
                <td>{p.active ? <span className="badge">Active</span> : <span className="badge red">Hidden</span>}</td>
                {canEdit && (
                  <td className="right">
                    <button className="btn small" onClick={() => setEdit({ ...p, price: p.price, cost: p.cost, custom: p.custom || {}, opening: '' })}>Edit</button>{' '}
                    <button className="btn small" onClick={() => toggle(p)}>{p.active ? 'Hide' : 'Show'}</button>
                  </td>
                )}
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan="8" className="muted">Nothing here yet.</td></tr>}
          </tbody>
        </table>
        {shown.length > limit && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <button className="btn" onClick={() => setLimit((n) => n + PAGE)}>Show more ({shown.length - limit} left)</button>
          </div>
        )}
      </div>

      {edit && (
        <Modal title={edit.id ? `Edit ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`} onClose={() => setEdit(null)}>
          <form onSubmit={save}>
            <label className="field"><span>Name</span><input className="input" required value={edit.name} onChange={set('name')} /></label>
            {barcodeOn && (
              <label className="field"><span>Barcode (scan it here, or use the camera)</span>
                <div className="barcode-field">
                  <input
                    className="input" value={edit.barcode || ''} onChange={set('barcode')}
                    // a USB scanner ends with Enter: look the name up instead of saving a half-filled form
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!edit.id && !edit.name.trim()) lookup(edit.barcode); } }}
                    onBlur={() => { if (!edit.id && !edit.name.trim() && look?.code !== edit.barcode?.trim()) lookup(edit.barcode); }}
                  />
                  <button type="button" className="btn small" onClick={() => setScan('field')}>Camera</button>
                </div>
                {look && look.code === edit.barcode?.trim() && !edit.id && (
                  <span className={`small ${look.state === 'found' ? 'ok' : 'muted'}`} style={{ display: 'block', marginTop: 6 }} role="status">{look.text}</span>
                )}
              </label>
            )}
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
            {!edit.id && edit.track_stock && branches.length > 1 && !isCashier && (
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
      {scan && (
        <CameraScanner
          single
          title={scan === 'find' ? `Scan a ${label.toLowerCase()}` : 'Scan its barcode'}
          onCode={scan === 'find' ? onFind : onField}
          onClose={() => setScan(null)}
        />
      )}
    </>
  );
}
