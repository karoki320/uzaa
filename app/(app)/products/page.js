'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { money, num, UNITS } from '@/lib/util';
import Modal from '@/components/Modal';
import CameraScanner from '@/components/CameraScanner';
import { findByBarcode } from '@/lib/barcode';
import { post } from '@/lib/api';

const TONES = ['var(--c-teal)', 'var(--c-ice)', 'var(--c-lav)', 'var(--c-amber)', 'var(--c-peach)', 'var(--c-pale)'];
const toneFor = (k) => { let h = 0; for (const ch of String(k || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return TONES[h % TONES.length]; };
const initialsOf = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
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
  const [costMode, setCostMode] = useState(false);   // the "fill in cost prices" list
  const [costs, setCosts] = useState({});            // typed costs in that list, by product id
  const skipCost = useRef(false);                    // "save without a cost" was pressed
  // stock of the item being edited, per branch: { now: {branchId: qty}, val: {branchId: typed}, mode, reason, hist }
  const [stk, setStk] = useState(null);
  const editId = edit?.id;
  useEffect(() => {
    setStk(null);
    if (!editId || !canEdit) return;
    let off = false;
    Promise.all([
      supabase.from('stock').select('branch_id,qty').eq('product_id', editId),
      supabase.from('stock_movements').select('change,reason,created_at,branch_id').eq('product_id', editId).order('created_at', { ascending: false }).limit(6),
    ]).then(([a, b]) => {
      if (off) return;
      const now = {};
      branches.forEach((br) => (now[br.id] = 0));
      (a.data || []).forEach((x) => (now[x.branch_id] = Number(x.qty)));
      setStk({ now, val: {}, mode: 'count', reason: 'Stock count correction', hist: b.data || [] });
    });
    return () => { off = true; };
  }, [editId, canEdit, branches]);
  // what each branch's stock changes by when the form is saved
  const stockDelta = (bid) => {
    if (!stk) return 0;
    const t = String(stk.val[bid] ?? '').trim();
    if (t === '' || isNaN(Number(t))) return 0;
    return stk.mode === 'count' ? Math.round((Number(t) - stk.now[bid]) * 1000) / 1000 : Number(t);
  };

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
    const base = costMode ? rows.filter((p) => p.active && !(Number(p.cost) > 0)) : rows;
    return t ? base.filter((p) => p.name.toLowerCase().includes(t) || (p.barcode || '').includes(t) || (p.category || '').toLowerCase().includes(t)) : base;
  }, [rows, q, costMode]);
  const noCost = rows.filter((p) => p.active && !(Number(p.cost) > 0)).length;
  const hidden = rows.filter((p) => !p.active).length;

  async function saveCost(p) {
    const v = Number(costs[p.id]);
    if (!(v > 0)) return;
    setRows((list) => list.map((r) => (r.id === p.id ? { ...r, cost: v } : r)));
    const { error } = await supabase.from('products').update({ cost: v }).eq('id', p.id);
    if (error) { setErr(error.message); load(); }
  }

  async function save(e) {
    e.preventDefault();
    setErr('');
    // profit and stock value need what the shop paid: ask once before saving a new item without it
    if (!edit.id && !(Number(edit.cost) > 0) && !skipCost.current) { setEdit({ ...edit, askCost: true }); return; }
    skipCost.current = false;
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
    // bulk price and shared stock (only once the database has the columns: security-patch-16.sql)
    if (hasNew) {
      const bm = Number(edit.bulk_min) || 0, bp = edit.bulk_price === '' || edit.bulk_price == null ? null : Number(edit.bulk_price);
      payload.bulk_min = bm > 0 && bp != null && bp >= 0 ? bm : null;
      payload.bulk_price = payload.bulk_min ? bp : null;
      payload.stock_of = !payload.track_stock && edit.stock_of && edit.stock_of !== edit.id ? edit.stock_of : null;
    }
    let error;
    let saved = null;
    if (edit.id) {
      const res = await supabase.from('products').update(payload).eq('id', edit.id).select('*').single();
      error = res.error;
      saved = res.data;
      // stock changes typed in the table, one movement per branch, with the chosen reason
      if (!error && payload.track_stock && stk) {
        for (const br of branches) {
          const d = stockDelta(br.id);
          if (!d) continue;
          if (stk.now[br.id] + d < 0) { error = { message: `${br.name}: stock cannot go below 0` }; break; }
          const r2 = await supabase.rpc('adjust_stock', { p_product: edit.id, p_branch: br.id, p_change: d, p_reason: stk.reason });
          if (r2.error) { error = r2.error; break; }
        }
      }
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

  // ---- select several items: long-press one (or press Select), then tap others; hide, show or delete them together
  const [picked, setPicked] = useState(null);        // null = not selecting, else a Set of ids
  const [confirmDel, setConfirmDel] = useState(false);
  const press = useRef(null);
  const selecting = !!picked && canEdit;
  const pick = (id) => setPicked((cur) => { const n = new Set(cur || []); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const holdStart = (id) => (e) => {
    if (!canEdit || costMode || e.button > 0) return;
    const at = { x: e.clientX, y: e.clientY };
    press.current = { id, at, fired: false, t: setTimeout(() => {
      press.current.fired = true;
      try { navigator.vibrate?.(30); } catch {}
      setPicked((cur) => { const n = new Set(cur || []); n.add(id); return n; });
    }, 480) };
  };
  const holdMove = (e) => {
    const h = press.current;
    if (h && !h.fired && (Math.abs(e.clientX - h.at.x) > 10 || Math.abs(e.clientY - h.at.y) > 10)) { clearTimeout(h.t); press.current = null; }   // scrolling, not holding
  };
  const holdEnd = () => { const h = press.current; if (h) clearTimeout(h.t); };
  const rowTap = (p) => (e) => {
    const h = press.current;
    press.current = null;
    if (h?.fired) return;                       // the long press itself already selected it
    if (selecting && !e.target.closest('button, input, a')) pick(p.id);
  };
  const ids = picked ? [...picked] : [];
  async function bulkActive(active) {
    setRows((list) => list.map((r) => (picked.has(r.id) ? { ...r, active } : r)));
    const { error } = await supabase.from('products').update({ active }).in('id', ids);
    if (error) { setErr(error.message); load(); }
    setPicked(null);
  }
  async function bulkDelete() {
    setBusy(true); setErr('');
    const { error } = await supabase.from('products').delete().in('id', ids);
    setBusy(false);
    setConfirmDel(false);
    if (error) return setErr(error.message);
    setRows((list) => list.filter((r) => !picked.has(r.id)));
    setPicked(null);
  }

  async function toggle(p) {
    setRows((list) => list.map((r) => (r.id === p.id ? { ...r, active: !p.active } : r)));   // show it at once
    const { error } = await supabase.from('products').update({ active: !p.active }).eq('id', p.id);
    if (error) load();
  }

  const hasNew = rows.length > 0 && 'bulk_min' in rows[0];
  const stockSources = useMemo(() => rows.filter((r) => r.track_stock && r.active !== false), [rows]);
  const unitName = edit?.unit || 'unit';
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setCustom = (k) => (e) => setEdit({ ...edit, custom: { ...edit.custom, [k]: e.target.value } });

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{label}s</h1>
        <div className="row" style={{ gap: 8 }}>
          {barcodeOn && <button className="btn" onClick={() => setScan('find')}>Scan</button>}
          {canEdit && !selecting && rows.length > 0 && <button className="btn" onClick={() => setPicked(new Set())}>Select</button>}
          {canAdd && <button className="btn primary" onClick={() => { skipCost.current = false; setEdit({ ...blank }); }}>+ Add</button>}
        </div>
      </div>

      <section className="hero">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="k">In your catalogue</div>
          <div className="big">{rows.length - hidden}</div>
          <p>{label.toLowerCase()}s on sale{hidden ? `, ${hidden} hidden` : ''}{cats.length ? ` in ${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}` : ''}.</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <i style={{ height: 40, background: '#85C6C1' }} /><i style={{ height: 58, background: '#A3A2D8' }} /><i style={{ height: 28, background: '#F5CF86' }} />
        </div>
      </section>

      {canEdit && noCost > 0 && (
        <div className="alert">
          <span className="ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2v20M17 6H9.5a3 3 0 000 6h5a3 3 0 010 6H6" /></svg></span>
          <span>{costMode ? 'Type what you paid for each item. It saves as you go.' : <><b>{noCost} item{noCost === 1 ? ' has' : 's have'} no cost price.</b> Profit and stock value stay wrong until you add them.</>}</span>
          <button className="btn small" onClick={() => { setCostMode((v) => !v); setQ(''); }}>{costMode ? 'Done' : 'Fill them in'}</button>
        </div>
      )}

      <input className="input" placeholder={barcodeOn ? 'Search by name, barcode or category' : 'Search by name or category'} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} aria-label="Search" />

      <div className="card">
        {shown.slice(0, limit).map((p) => {
          const price = Number(p.price), cost = Number(p.cost);
          const margin = price > 0 && cost > 0 ? Math.round(((price - cost) / price) * 100) : null;
          return (
            <div className={`lrow ${canEdit && !costMode ? 'hold' : ''} ${selecting && picked.has(p.id) ? 'picked' : ''}`} key={p.id}
              style={{ opacity: p.active ? 1 : 0.6, flexWrap: costMode ? 'wrap' : 'nowrap', cursor: selecting ? 'pointer' : undefined }}
              onPointerDown={holdStart(p.id)} onPointerMove={holdMove} onPointerUp={holdEnd} onPointerLeave={holdEnd} onPointerCancel={holdEnd}
              onClick={rowTap(p)} onContextMenu={(e) => { if (canEdit) e.preventDefault(); }}
              aria-selected={selecting ? picked.has(p.id) : undefined}>
              {selecting
                ? <span className={`rank tick ${picked.has(p.id) ? 'on' : ''}`} role="checkbox" aria-checked={picked.has(p.id)} aria-label={`Select ${p.name}`} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(p.id); } }}>{picked.has(p.id) ? '✓' : ''}</span>
                : <span className="rank" style={{ background: toneFor(p.category || p.name) }}>{initialsOf(p.name)}</span>}
              <span className="grow2">
                <b style={{ fontSize: 14 }}>{p.name}{!p.active && <span className="badge red" style={{ marginLeft: 6, fontSize: 11 }}>Hidden</span>}</b>
                <span>{[p.category, barcodeOn && p.barcode].filter(Boolean).join(' · ') || 'No category'}</span>
                {canEdit && !costMode && <span>{cost > 0 ? `Cost ${money(cost, business.currency)}` : 'No cost price'}{margin !== null && <b style={{ color: margin < 10 ? '#7A2A00' : '#0A4F74' }}> · {margin}% margin</b>}</span>}
              </span>
              <span className="amt">{money(p.price, business.currency)}<span className="muted small" style={{ fontWeight: 600 }}> /{p.unit || 'pc'}</span></span>
              {costMode ? (
                <span style={{ display: 'flex', gap: 6, width: '100%' }}>
                  <input className="input" inputMode="decimal" placeholder={`What you paid (${business.currency})`} value={costs[p.id] ?? ''} onChange={(e) => setCosts({ ...costs, [p.id]: e.target.value })} onBlur={() => saveCost(p)} onKeyDown={(e) => { if (e.key === 'Enter') saveCost(p); }} aria-label={`Cost price for ${p.name}`} style={{ minHeight: 44 }} />
                  <button className="btn small primary" onClick={() => saveCost(p)} disabled={!(Number(costs[p.id]) > 0)}>Save</button>
                </span>
              ) : canEdit && !selecting && (
                <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button className="btn small" onClick={() => { skipCost.current = false; setEdit({ ...p, price: p.price, cost: p.cost, custom: p.custom || {}, opening: '' }); }}>Edit</button>
                  <button className="btn small" onClick={() => toggle(p)}>{p.active ? 'Hide' : 'Show'}</button>
                </span>
              )}
            </div>
          );
        })}
        {shown.length === 0 && <p className="muted" style={{ margin: 0 }}>{costMode ? 'Every item has a cost price now.' : 'Nothing here yet.'}</p>}
        {shown.length > limit && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <button className="btn" onClick={() => setLimit((n) => n + PAGE)}>Show more ({shown.length - limit} left)</button>
          </div>
        )}
      </div>

      {selecting && (
        <div className="selbar no-print" role="toolbar" aria-label="Selected items">
          <b style={{ whiteSpace: 'nowrap' }}>{ids.length} selected</b>
          <button className="btn small" onClick={() => setPicked(ids.length === shown.length ? new Set() : new Set(shown.map((p) => p.id)))}>{ids.length === shown.length && shown.length ? 'None' : 'All'}</button>
          <span style={{ flex: 1 }} />
          <button className="btn small" disabled={!ids.length} onClick={() => bulkActive(false)}>Hide</button>
          <button className="btn small" disabled={!ids.length} onClick={() => bulkActive(true)}>Show</button>
          <button className="btn small danger" disabled={!ids.length} onClick={() => setConfirmDel(true)}>Delete</button>
          <button className="btn small" aria-label="Stop selecting" onClick={() => setPicked(null)}>✕</button>
        </div>
      )}
      {confirmDel && (
        <Modal title={`Delete ${ids.length} ${ids.length === 1 ? label.toLowerCase() : `${label.toLowerCase()}s`}?`} onClose={() => setConfirmDel(false)}>
          <p style={{ marginTop: 0 }}>{rows.filter((r) => picked.has(r.id)).slice(0, 5).map((r) => r.name).join(', ')}{ids.length > 5 ? ` and ${ids.length - 5} more` : ''}.</p>
          <div className="alert" style={{ marginBottom: 14 }}>
            <span>This cannot be undone. Their stock and stock history are removed. Past sales and receipts keep the item names.
              If you might sell them again, <b>Hide</b> them instead.</span>
          </div>
          {err && <div className="err">{err}</div>}
          <div className="row">
            <button className="btn danger grow" disabled={busy} onClick={bulkDelete}>{busy ? 'Deleting...' : 'Yes, delete'}</button>
            <button className="btn grow" disabled={busy} onClick={() => { setConfirmDel(false); bulkActive(false); }}>Hide them instead</button>
          </div>
        </Modal>
      )}

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
              <label className="field grow"><span>What you paid (per {unitName})</span><input className="input" inputMode="decimal" value={edit.cost} onChange={(e) => setEdit({ ...edit, cost: e.target.value, askCost: false })} placeholder="Cost price" /></label>
            </div>
            {Number(edit.price) > 0 && Number(edit.cost) > 0 && (
              <p className="small" style={{ marginTop: -6 }}>You make <b>{money(Number(edit.price) - Number(edit.cost), business.currency)}</b> on each one ({Math.round(((Number(edit.price) - Number(edit.cost)) / Number(edit.price)) * 100)}% margin).</p>
            )}
            {hasNew && (
              <div className="row">
                <label className="field grow"><span>Bulk price (per {unitName}, optional)</span>
                  <input className="input" inputMode="decimal" value={edit.bulk_price ?? ''} onChange={set('bulk_price')} placeholder="e.g. 9" /></label>
                <label className="field grow"><span>Bulk price applies from</span>
                  <input className="input" inputMode="decimal" value={edit.bulk_min ?? ''} onChange={set('bulk_min')} placeholder={`e.g. 50 ${unitName}`} /></label>
              </div>
            )}
            {edit.askCost && (
              <div className="alert" style={{ marginBottom: 14 }}>
                <span><b>What did you pay for it?</b> Without the cost price, Uzaa counts the whole selling price as profit.</span>
              </div>
            )}
            {fields.map((f) => (
              <label className="field" key={f.key}>
                <span>{f.label}</span>
                <input className="input" type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={edit.custom?.[f.key] || ''} onChange={setCustom(f.key)} />
              </label>
            ))}
            <label className="row" style={{ marginBottom: 14 }}>
              <input type="checkbox" checked={!!edit.track_stock} onChange={set('track_stock')} /> Track stock for this {label.toLowerCase()}
            </label>
            {hasNew && !edit.track_stock && (
              <label className="field"><span>Sell from the stock of (optional)</span>
                <select className="input" value={edit.stock_of || ''} onChange={set('stock_of')}>
                  <option value="">Nothing: this {label.toLowerCase()} has no stock count</option>
                  {stockSources.filter((r) => r.id !== edit.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <span className="small muted">For example a wholesale oil that is poured from the same bottle as the retail one.</span>
              </label>
            )}
            {edit.track_stock && (
              <div className="row">
                <label className="field grow"><span>Low stock warning at</span><input className="input" inputMode="decimal" value={edit.low_stock_level} onChange={set('low_stock_level')} /></label>
                {!edit.id && (
                  <label className="field grow"><span>Opening stock</span><input className="input" inputMode="decimal" value={edit.opening} onChange={set('opening')} /></label>
                )}
              </div>
            )}
            {edit.id && edit.track_stock && canEdit && (
              <div className="card" style={{ padding: 14, marginBottom: 14 }}>
                <div className="card-head" style={{ marginBottom: 8 }}><h3>Stock</h3>
                  {stk && (
                    <div className="segs" role="tablist" aria-label="How to enter stock" style={{ margin: 0, padding: 3 }}>
                      {[['count', 'New count'], ['change', 'Add / remove']].map(([k, l]) => (
                        <button type="button" key={k} role="tab" aria-selected={stk.mode === k} className={stk.mode === k ? 'on' : ''} style={{ minHeight: 34, padding: '0 10px', fontSize: 12 }}
                          onClick={() => setStk({ ...stk, mode: k, val: {}, reason: k === 'count' ? 'Stock count correction' : 'Received stock' })}>{l}</button>
                      ))}
                    </div>
                  )}
                </div>
                {!stk ? <p className="muted small" style={{ margin: 0 }}>Loading stock...</p> : (
                  <>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Branch</th><th className="num">In stock</th><th className="num">{stk.mode === 'count' ? 'Counted' : 'Add (+) / remove (-)'}</th><th className="num">After</th></tr></thead>
                        <tbody>
                          {branches.map((br) => {
                            const d = stockDelta(br.id);
                            const after = Math.round((stk.now[br.id] + d) * 1000) / 1000;
                            return (
                              <tr key={br.id}>
                                <td>{br.name}</td>
                                <td className="num">{num(stk.now[br.id])}{edit.unit && edit.unit !== 'pc' ? ` ${edit.unit}` : ''}</td>
                                <td className="num">
                                  <input className="input" inputMode="decimal" value={stk.val[br.id] ?? ''} onChange={(e) => setStk({ ...stk, val: { ...stk.val, [br.id]: e.target.value } })}
                                    placeholder={stk.mode === 'count' ? num(stk.now[br.id]) : '+0'} aria-label={`${stk.mode === 'count' ? 'Counted stock' : 'Stock change'} at ${br.name}`}
                                    style={{ width: 96, minHeight: 40, textAlign: 'right', marginLeft: 'auto' }} />
                                </td>
                                <td className="num" style={{ fontWeight: d ? 800 : 400, color: after < 0 ? 'var(--error)' : undefined }}>
                                  {num(after)}{d ? <div className="small" style={{ color: d > 0 ? '#0A4F74' : '#7A2A00' }}>{d > 0 ? '+' : ''}{num(d)}</div> : null}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {branches.some((br) => stockDelta(br.id)) && (
                      <label className="field" style={{ margin: '10px 0 0' }}><span>Reason</span>
                        <select className="input" value={stk.reason} onChange={(e) => setStk({ ...stk, reason: e.target.value })}>
                          {['Stock count correction', 'Received stock', 'Returned by customer', 'Damaged or expired', 'Returned to supplier', 'Used in the shop', 'Other'].map((r) => <option key={r}>{r}</option>)}
                        </select>
                      </label>
                    )}
                    {stk.hist.length > 0 && (
                      <details style={{ marginTop: 10 }}>
                        <summary className="small" style={{ cursor: 'pointer', fontWeight: 700 }}>Recent changes</summary>
                        {stk.hist.map((h, i) => (
                          <div key={i} className="row between small" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                            <span>{h.reason}{branches.length > 1 ? ` · ${branches.find((b) => b.id === h.branch_id)?.name || ''}` : ''}<br /><span className="muted">{new Date(h.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</span></span>
                            <b style={{ color: Number(h.change) > 0 ? '#0A4F74' : '#7A2A00' }}>{Number(h.change) > 0 ? '+' : ''}{num(h.change)}</b>
                          </div>
                        ))}
                      </details>
                    )}
                    <p className="small muted" style={{ margin: '8px 0 0' }}>Leave a box empty to keep that branch's stock as it is. The change is saved with the item.</p>
                  </>
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
            {edit.askCost && <button className="btn" style={{ width: '100%', marginTop: 10 }} disabled={busy} onClick={() => { skipCost.current = true; }}>Save without a cost price</button>}
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
