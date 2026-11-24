'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { money, num, fmtDate, waLink } from '@/lib/util';
import Modal from '@/components/Modal';
import CountUp from '@/components/CountUp';
import { loyaltyOn, pointsWorth } from '@/lib/loyalty';
import { methodName } from '@/lib/credit';

// Customers and loyalty points (patch 22). Shown when the super admin switches on Loyalty for the business.
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const SORTS = [['recent', 'Recent'], ['spent', 'Top spenders'], ['points', 'Most points'], ['name', 'A to Z']];

export default function Customers() {
  const { business, profile } = useAuth();
  const cur = business.currency;
  const canEdit = profile.role === 'owner' || profile.role === 'manager';
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('recent');
  const [open, setOpen] = useState(null);
  const [add, setAdd] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const on = loyaltyOn(business);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('customer_list').select('*').eq('active', true).range(0, 4999);
    if (error) return setErr(/customer_list/.test(error.message) ? 'Run security-patch-22.sql in Supabase first.' : error.message);
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = t ? rows.filter((r) => r.name.toLowerCase().includes(t) || (r.phone || '').includes(t)) : [...rows];
    const by = {
      recent: (a, b) => String(b.last_sale || b.created_at).localeCompare(String(a.last_sale || a.created_at)),
      spent: (a, b) => Number(b.spent) - Number(a.spent),
      points: (a, b) => Number(b.points) - Number(a.points),
      name: (a, b) => a.name.localeCompare(b.name),
    }[sort];
    return f.sort(by);
  }, [rows, q, sort]);

  const totalPts = rows.reduce((s, r) => s + Math.max(0, Number(r.points) || 0), 0);
  const month = new Date(Date.now() - 30 * 864e5).toISOString();
  const active30 = rows.filter((r) => r.last_sale && r.last_sale >= month).length;

  async function saveCustomer() {
    const name = add.name.trim();
    if (!name) return setErr('Enter the name');
    setBusy(true); setErr('');
    const { error } = await supabase.from('customers').insert({
      business_id: business.id, name: name.slice(0, 80), phone: add.phone.trim().slice(0, 20), note: add.note.trim().slice(0, 300),
    });
    setBusy(false);
    if (error) return setErr(/duplicate|unique/i.test(error.message) ? 'That number is already saved for another customer' : error.message);
    setAdd(null); load();
  }

  if (!business.features?.loyalty) {
    return <div className="card"><h2>Customers</h2><p className="muted">This screen is not switched on for your business. Ask Uzaa support.</p></div>;
  }

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Customers</h1>
        <button className="btn primary" onClick={() => { setAdd({ name: '', phone: '', note: '' }); setErr(''); }}>+ Customer</button>
      </div>

      {!on && profile.role === 'owner' && (
        <div className="tint" style={{ marginBottom: 12 }}>Loyalty points are off. Turn them on and set how points are earned under Settings &gt; Loyalty points.</div>
      )}

      <section className="hero">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="k">Your customers</div>
          <div className="big"><CountUp value={rows.length} format={(v) => num(Math.round(v))} /></div>
          <p>
            <b>{active30}</b> bought in the last 30 days.
            {on && <> They hold <b>{num(totalPts)}</b> points, worth {money(pointsWorth(totalPts, business), cur)}.</>}
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <i style={{ height: 52, background: '#F5CF86' }} /><i style={{ height: 34, background: '#85C6C1' }} /><i style={{ height: 22, background: '#A3A2D8' }} />
        </div>
      </section>

      <input className="input" style={{ marginBottom: 8 }} placeholder="Search a name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
      <div className="chips" role="tablist" aria-label="Sort" style={{ marginBottom: 12 }}>
        {SORTS.filter(([k]) => on || k !== 'points').map(([k, l]) => <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{l}</button>)}
      </div>
      {err && <div className="err">{err}</div>}

      <div className="card">
        {list.length === 0 && <p className="muted" style={{ margin: 0 }}>{rows.length ? 'Nobody matches that.' : 'No customers yet. Add one here, or choose the customer at the till.'}</p>}
        {list.map((r) => (
          <button key={r.id} className="lrow" onClick={() => setOpen(r)}>
            <span className="rank" style={{ background: 'var(--c-teal)' }}>{initials(r.name)}</span>
            <span className="grow2">
              <b style={{ fontSize: 14 }}>{r.name}</b>
              <span>{r.phone || 'No number'} · {r.visits} visit{Number(r.visits) === 1 ? '' : 's'}{r.last_sale ? ` · last ${fmtDate(r.last_sale)}` : ''}</span>
            </span>
            <span className="amt" style={{ textAlign: 'right' }}>
              {on && <b style={{ display: 'block' }}>{num(r.points)} pts</b>}
              <span className="small muted">{money(r.spent, cur)}</span>
            </span>
          </button>
        ))}
      </div>

      {add && (
        <Modal title="Add a customer" onClose={() => setAdd(null)}>
          <label className="field"><span>Name</span><input className="input" autoFocus value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></label>
          <label className="field"><span>Phone number</span><input className="input" inputMode="tel" placeholder="0722 000 111" value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} /></label>
          <label className="field"><span>Note (sizes, style, birthday...)</span><input className="input" value={add.note} onChange={(e) => setAdd({ ...add, note: e.target.value })} /></label>
          {err && <div className="err">{err}</div>}
          <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={saveCustomer}>{busy ? 'Saving...' : 'Save customer'}</button>
        </Modal>
      )}

      {open && (
        <CustomerSheet row={open} cur={cur} canEdit={canEdit} business={business} on={on}
          onClose={() => setOpen(null)} onChanged={() => { load(); setOpen(null); }} />
      )}
    </>
  );
}

function CustomerSheet({ row, cur, canEdit, business, on, onClose, onChanged }) {
  const [sales, setSales] = useState([]);
  const [hist, setHist] = useState([]);
  const [edit, setEdit] = useState(null);
  const [adj, setAdj] = useState({ pts: '', why: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('sales').select('id,receipt_no,total,payment_method,points_earned,points_used,created_at').eq('customer_id', row.id)
      .order('created_at', { ascending: false }).limit(50).then(({ data }) => setSales(data || []));
    if (on) supabase.from('loyalty_points').select('id,points,reason,created_at').eq('customer_id', row.id)
      .order('created_at', { ascending: false }).limit(50).then(({ data }) => setHist(data || []));
  }, [row.id, on]);

  const pts = Number(row.points) || 0;
  const worth = pointsWorth(pts, business);
  const msg = on
    ? `Hello ${row.name}, this is ${business.name}. You have ${num(pts)} loyalty points, worth ${money(worth, cur)} off your next purchase. Karibu tena.`
    : `Hello ${row.name}, this is ${business.name}. Karibu tena.`;
  const wa = waLink(row.phone, msg);

  async function saveEdit() {
    if (!edit.name.trim()) return setErr('Enter the name');
    setBusy(true); setErr('');
    const { error } = await supabase.from('customers').update({ name: edit.name.trim().slice(0, 80), phone: edit.phone.trim().slice(0, 20), note: edit.note.trim().slice(0, 300) }).eq('id', row.id);
    setBusy(false);
    if (error) return setErr(/duplicate|unique/i.test(error.message) ? 'That number is already saved for another customer' : error.message);
    onChanged();
  }

  async function adjust(sign) {
    const n = Math.trunc(Number(adj.pts));
    if (!(n > 0)) return setErr('Enter the number of points');
    if (adj.why.trim().length < 3) return setErr('Write why (for example: welcome bonus, correction)');
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('loyalty_adjust', { p_customer: row.id, p_points: sign * n, p_reason: adj.why.trim() });
    setBusy(false);
    if (error) return setErr(error.message);
    onChanged();
  }

  return (
    <Modal title={row.name} onClose={onClose}>
      <div className="hero" style={{ marginBottom: 14, padding: 16 }}>
        <div>
          {on && <div className="big" style={{ fontSize: 30 }}>{num(pts)} points</div>}
          <p style={{ fontSize: 13 }}>
            {on && <>Worth {money(worth, cur)} &middot; </>}spent {money(row.spent, cur)} in {row.visits} visit{Number(row.visits) === 1 ? '' : 's'}
            {Number(row.balance) > 0 && <> &middot; owes {money(row.balance, cur)}</>}
          </p>
          <p style={{ fontSize: 13 }}>{row.phone || 'No number saved'}{row.note ? ` · ${row.note}` : ''}</p>
        </div>
      </div>

      <div className="row" style={{ gap: 8 }}>
        {wa && <a className="btn grow" href={wa} target="_blank" rel="noreferrer" style={{ textAlign: 'center', textDecoration: 'none', lineHeight: '28px' }}>WhatsApp</a>}
        {canEdit && !edit && <button className="btn grow" onClick={() => setEdit({ name: row.name, phone: row.phone || '', note: row.note || '' })}>Edit details</button>}
      </div>

      {edit && (
        <div className="tint" style={{ marginTop: 10 }}>
          <label className="field"><span>Name</span><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="field"><span>Phone number</span><input className="input" inputMode="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
          <label className="field"><span>Note</span><input className="input" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></label>
          <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={saveEdit}>{busy ? 'Saving...' : 'Save'}</button>
        </div>
      )}

      {on && canEdit && (
        <div style={{ marginTop: 14 }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ marginBottom: 0, width: 110 }}><span>Points</span>
              <input className="input" inputMode="numeric" value={adj.pts} onChange={(e) => /^\d*$/.test(e.target.value) && setAdj({ ...adj, pts: e.target.value })} placeholder="50" />
            </label>
            <label className="field grow" style={{ marginBottom: 0 }}><span>Why</span>
              <input className="input" value={adj.why} onChange={(e) => setAdj({ ...adj, why: e.target.value })} placeholder="Welcome bonus" />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn grow" disabled={busy} onClick={() => adjust(1)}>Add points</button>
            <button className="btn grow" disabled={busy} onClick={() => adjust(-1)}>Take off points</button>
          </div>
        </div>
      )}
      {err && <div className="err">{err}</div>}

      <h3 style={{ marginBottom: 6 }}>Purchases</h3>
      {sales.length === 0 && <p className="muted small" style={{ marginTop: 0 }}>Nothing yet.</p>}
      {sales.map((s) => (
        <div key={s.id} className="pendrow">
          <div><b>#{s.receipt_no}</b><div className="small muted">{fmtDate(s.created_at)} · {methodName(s.payment_method, business)}</div></div>
          <div style={{ textAlign: 'right' }}>
            <b>{money(s.total, cur)}</b>
            {on && (Number(s.points_earned) > 0 || Number(s.points_used) > 0) && (
              <div className="small muted">
                {Number(s.points_earned) > 0 && `+${num(s.points_earned)} pts`}
                {Number(s.points_earned) > 0 && Number(s.points_used) > 0 && ' · '}
                {Number(s.points_used) > 0 && `used ${num(s.points_used)}`}
              </div>
            )}
          </div>
        </div>
      ))}

      {on && (
        <>
          <h3 style={{ marginBottom: 6 }}>Points history</h3>
          {hist.length === 0 && <p className="muted small" style={{ marginTop: 0 }}>None yet.</p>}
          {hist.map((h) => (
            <div key={h.id} className="pendrow">
              <div><b style={{ color: Number(h.points) < 0 ? 'var(--error)' : undefined }}>{Number(h.points) > 0 ? '+' : ''}{num(h.points)}</b><div className="small muted">{h.reason}</div></div>
              <div className="small muted">{fmtDate(h.created_at)}</div>
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}
