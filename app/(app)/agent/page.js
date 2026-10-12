'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { post } from '@/lib/api';
import { fmtDate, TYPE_PRESETS } from '@/lib/util';
import Modal from '@/components/Modal';

const STATUS = {
  pending: { label: 'Not active yet', cls: 'amber' },
  active: { label: 'Live', cls: '' },
  suspended: { label: 'Suspended', cls: 'red' },
};

export default function Agent() {
  const { profile } = useAuth();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [add, setAdd] = useState(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('agent_businesses');
    if (error) return setErr(error.message);
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows || []).filter((r) => !t || r.name.toLowerCase().includes(t) || (r.owner_email || '').includes(t));
  }, [rows, q]);

  if (err) return <div className="err">{err}</div>;
  if (!rows) return <div className="muted">Loading...</div>;

  const live = rows.filter((r) => r.status === 'active').length;
  const waiting = rows.filter((r) => r.status === 'pending').length;
  const joined = rows.filter((r) => r.joined).length;

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1>My businesses</h1>
        <button className="btn primary" onClick={() => setAdd({})}>Set up a business</button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Sign a shop up here and the owner gets an email to set their own password. Uzaa activates it once the
        first payment is in. You see the name and the status only, never their sales.
      </p>

      <div className="kpis">
        <div className="kpi"><div className="v">{rows.length}</div><div className="l">Signed up</div></div>
        <div className="kpi"><div className="v">{live}</div><div className="l">Live</div></div>
        <div className="kpi"><div className="v">{waiting}</div><div className="l">Waiting for activation</div></div>
        <div className="kpi"><div className="v">{joined}</div><div className="l">Owner has signed in</div></div>
      </div>

      {rows.length > 4 && (
        <input className="input" style={{ marginBottom: 12 }} placeholder="Search a business or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      )}

      <div className="card">
        {list.length === 0 && <p className="muted" style={{ margin: 0 }}>{rows.length ? 'Nothing matches that.' : 'No businesses yet. Set up your first one.'}</p>}
        {list.map((r) => (
          <div key={r.id} className="debtrow" style={{ cursor: 'default' }}>
            <div>
              <b>{r.name}</b>
              <div className="small muted">{r.owner_name} &middot; {r.owner_email}{r.owner_phone ? ` \u00b7 ${r.owner_phone}` : ''}</div>
              <div className="small muted">
                Added {fmtDate(r.created_at)} &middot; {r.joined ? 'owner has signed in' : 'invite not opened yet'}
              </div>
            </div>
            <span className={`badge ${STATUS[r.status]?.cls || ''}`}>{STATUS[r.status]?.label || r.status}</span>
          </div>
        ))}
      </div>

      {add && <AddBusiness onClose={() => setAdd(null)} onDone={() => { setAdd(null); load(); }} agent={profile.full_name} />}
    </>
  );
}

function AddBusiness({ onClose, onDone }) {
  const [f, setF] = useState({ owner_name: '', name: '', owner_email: '', owner_phone: '', type: 'retail', branch: 'Main Branch' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await post('/api/agent/business', f);
    setBusy(false);
    if (!r.ok) return setErr(r.data.error || 'Could not set that up');
    onDone();
  }

  return (
    <Modal title="Set up a business" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field"><span>Name of the proprietor</span><input className="input" required autoFocus value={f.owner_name} onChange={set('owner_name')} placeholder="Jane Mwangi" /></label>
        <label className="field"><span>Name of the business</span><input className="input" required value={f.name} onChange={set('name')} placeholder="Duka la Mama Njeri" /></label>
        <label className="field"><span>Their email (the sign-up link goes here)</span><input className="input" type="email" required value={f.owner_email} onChange={set('owner_email')} placeholder="jane@example.com" /></label>
        <label className="field"><span>Their phone number</span><input className="input" type="tel" inputMode="tel" required value={f.owner_phone} onChange={set('owner_phone')} placeholder="0722 000 111" /></label>
        <label className="field"><span>What kind of business</span>
          <select className="input" value={f.type} onChange={set('type')}>
            {Object.entries(TYPE_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="field"><span>First branch</span><input className="input" value={f.branch} onChange={set('branch')} /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <p className="muted small">
          The owner gets an email with a link to choose their password. They can set their shop up straight away,
          and selling starts once Uzaa activates the account.
        </p>
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Setting up...' : 'Create and invite the owner'}</button>
      </form>
    </Modal>
  );
}
