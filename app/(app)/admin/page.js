'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fmtDate, money, num } from '@/lib/util';
import { post } from '@/lib/api';
import Modal from '@/components/Modal';

export default function Admin() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [del, setDel] = useState(null);      // { id, name, counts, typed }

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_overview');
    if (error) return setErr(error.message);
    setRows(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(b) {
    const next = b.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended' && !window.confirm(`Suspend ${b.name}? Their users will be locked out.`)) return;
    if (b.status === 'pending' && !window.confirm(`Activate ${b.name}? They can start selling straight away.`)) return;
    const { error } = await supabase.from('businesses').update({ status: next }).eq('id', b.id);
    if (error) return alert(error.message);
    load();
  }

  async function askDelete(b) {
    setErr('');
    const r = await post('/api/admin/business', { id: b.id });
    if (!r.ok) { setErr(r.data.error || 'Could not read that business'); return load(); }
    setDel({ id: b.id, name: b.name, counts: r.data, typed: '' });
  }

  async function reallyDelete() {
    const r = await fetch('/api/admin/business', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: del.id, confirm: del.typed }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setDel({ ...del, err: j.error || 'Could not remove that business' });
    setDel(null);
    load();
  }

  if (!rows) return err ? <div className="err">{err}</div> : <div className="muted">Loading...</div>;

  const week = rows.reduce((s, r) => s + Number(r.revenue_7d), 0);
  const active = rows.filter((r) => r.last_sale && Date.now() - new Date(r.last_sale) < 7 * 864e5).length;

  return (
    <>
      <h1>Uzaa admin</h1>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="kpis">
        <div className="kpi"><div className="v">{rows.length}</div><div className="l">Businesses</div></div>
        <div className="kpi"><div className="v">{active}</div><div className="l">Sold something in the last 7 days</div></div>
        <div className="kpi"><div className="v">{money(week)}</div><div className="l">Revenue across all, last 7 days</div></div>
        <div className="kpi"><div className="v">{num(rows.reduce((s, r) => s + Number(r.sales_count), 0))}</div><div className="l">Total sales recorded</div></div>
      </div>
      {del && (
        <Modal title={`Remove ${del.name}`} onClose={() => setDel(null)}>
          <p className="muted" style={{ marginTop: 0 }}>This removes the business and everything in it. It cannot be undone.</p>
          <div className="tint" style={{ marginBottom: 12 }}>
            <div className="small">{del.counts.branches} branch(es), {del.counts.staff} staff login(s), {del.counts.products} product(s), {del.counts.sales} sale(s), {del.counts.customers} credit customer(s)</div>
          </div>
          <label className="field"><span>Type <b>{del.name}</b> to confirm</span>
            <input className="input" autoFocus value={del.typed} onChange={(e) => setDel({ ...del, typed: e.target.value, err: '' })} />
          </label>
          {del.err && <div className="err" role="alert">{del.err}</div>}
          <button className="btn danger" style={{ width: '100%' }} disabled={del.typed.trim() !== del.name} onClick={reallyDelete}>
            Remove this business for good
          </button>
        </Modal>
      )}

      <SalesTeam />

      <h2 style={{ marginBottom: 8 }}>Businesses</h2>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Business</th><th>Owner</th><th>Type</th><th className="num">Branches</th><th className="num">Staff</th><th className="num">Sales</th><th className="num">7-day revenue</th><th>Last sale</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td><b>{b.name}</b><div className="small muted">Joined {fmtDate(b.created_at)}</div></td>
                <td>
                  {b.owner_email}
                  <div className="small muted">{b.agent_name ? `signed by ${b.agent_name}` : 'signed up themselves'}</div>
                  {Number(b.staff) === 0 && <div className="small warn">No login left for this business</div>}
                </td>
                <td>{b.business_type}</td>
                <td className="num">{b.branches}</td>
                <td className="num">{b.staff}</td>
                <td className="num">{num(b.sales_count)}</td>
                <td className="num">{money(b.revenue_7d)}</td>
                <td>{b.last_sale ? fmtDate(b.last_sale) : 'Never'}</td>
                <td>
                  {b.status === 'active' && <span className="badge">Active</span>}
                  {b.status === 'pending' && <span className="badge amber">Waiting for activation</span>}
                  {b.status === 'suspended' && <span className="badge red">Suspended</span>}
                </td>
                <td className="right">
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    <button className={`btn small ${b.status === 'active' ? 'danger' : 'primary'}`} onClick={() => toggle(b)}>{b.status === 'active' ? 'Suspend' : b.status === 'pending' ? 'Activate' : 'Reactivate'}</button>
                    <button className="btn small danger" onClick={() => askDelete(b)}>Remove</button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="10" className="muted">No businesses yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// The sales team: who is out there signing businesses up, and how they are doing.
function SalesTeam() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [add, setAdd] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_agents');
    if (error) return setErr(error.message);
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(a) {
    if (a.active && !window.confirm(`Turn off ${a.full_name}? They will not be able to sign in or add businesses.`)) return;
    const r = await post('/api/agent/invite', { id: a.id, active: !a.active });
    if (!r.ok) return alert(r.data.error || 'Could not save that');
    load();
  }

  return (
    <>
      <div className="row between" style={{ margin: '24px 0 8px' }}>
        <h2 style={{ margin: 0 }}>Sales team</h2>
        <button className="btn primary small" onClick={() => setAdd({})}>Add an agent</button>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th className="num">Signed up</th><th className="num">Live</th><th className="num">Waiting</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(rows || []).map((a) => (
              <tr key={a.id}>
                <td><b>{a.full_name}</b><div className="small muted">Added {fmtDate(a.created_at)}</div></td>
                <td>{a.email}</td>
                <td className="num">{a.signed}</td>
                <td className="num">{a.live}</td>
                <td className="num">{a.pending}</td>
                <td>{a.active ? <span className="badge">Active</span> : <span className="badge red">Off</span>}</td>
                <td className="right"><button className={`btn small ${a.active ? 'danger' : ''}`} onClick={() => toggle(a)}>{a.active ? 'Turn off' : 'Turn on'}</button></td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td colSpan="7" className="muted">Nobody on the sales team yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {add && <AddAgent onClose={() => setAdd(null)} onDone={() => { setAdd(null); load(); }} />}
    </>
  );
}

function AddAgent({ onClose, onDone }) {
  const [f, setF] = useState({ full_name: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await post('/api/agent/invite', f);
    setBusy(false);
    if (!r.ok) return setErr(r.data.error || 'Could not add them');
    onDone();
  }

  return (
    <Modal title="Add a sales agent" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field"><span>Their name</span><input className="input" required autoFocus value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
        <label className="field"><span>Their email</span><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <p className="muted small">
          They get an email with a link to choose their own password. They can sign businesses up and see their own
          list, and nothing inside any shop.
        </p>
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Sending...' : 'Send the invite'}</button>
      </form>
    </Modal>
  );
}
