'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fmtDate, money, num } from '@/lib/util';
import { post } from '@/lib/api';
import Modal from '@/components/Modal';
import { AGR, OnboardClient, NewAgreement, SendAgreement, AgreementList } from '@/components/AdminAgreements';

export default function Admin() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [del, setDel] = useState(null);      // { id, name, counts, typed }
  const [agrs, setAgrs] = useState(null);
  const [agrErr, setAgrErr] = useState('');
  const [tab, setTab] = useState('businesses');
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const [onboard, setOnboard] = useState(false);
  const [newAgr, setNewAgr] = useState(null);  // business
  const [send, setSend] = useState(null);      // { agreement, title, note }

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_overview');
    if (error) return setErr(error.message);
    setRows(data);
  }, []);
  const loadAgrs = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/agreements', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setAgrErr(j.error || 'Could not load agreements');
      setAgrErr(''); setAgrs(j.rows || []);
    } catch { setAgrErr('No connection'); }
  }, []);
  useEffect(() => { load(); loadAgrs(); }, [load, loadAgrs]);

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
    load(); loadAgrs();
  }

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (show !== 'all' && r.status !== show) return false;
      return !t || [r.name, r.owner_email, r.owner_name, r.owner_phone].some((x) => String(x || '').toLowerCase().includes(t));
    });
  }, [rows, q, show]);

  if (!rows) return err ? <div className="err">{err}</div> : <div className="muted">Loading...</div>;

  const sum = (k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  const week = sum('revenue_7d');
  const month = sum('revenue_30d');
  const prev = sum('revenue_prev_30d');
  const active = rows.filter((r) => r.last_sale && Date.now() - new Date(r.last_sale) < 7 * 864e5).length;
  const waiting = rows.filter((r) => r.status === 'pending').length;
  const unsigned = (agrs || []).filter((a) => a.status === 'sent' || a.status === 'viewed').length;
  const hasPerf = rows.length > 0 && Object.prototype.hasOwnProperty.call(rows[0], 'revenue_30d');

  // What needs the admin: signed and waiting to go live, unsigned for 3+ days, live but gone quiet.
  const attention = [
    ...rows.filter((r) => r.status === 'pending' && r.agreement_status === 'signed')
      .map((r) => ({ r, key: `go${r.id}`, text: `${r.name} signed the agreement. Activate them when payment is in.`, act: 'activate' })),
    ...(agrs || []).filter((a) => ['sent', 'viewed'].includes(a.status) && Date.now() - new Date(a.sent_at) > 3 * 864e5)
      .map((a) => ({ a, key: `ag${a.id}`, text: `${a.client_business || a.client_name} has not signed agreement ${a.ref} (sent ${fmtDate(a.sent_at)}).`, act: 'remind' })),
    ...rows.filter((r) => r.status === 'pending' && hasPerf && !r.agreement_status)
      .map((r) => ({ r, key: `na${r.id}`, text: `${r.name} is waiting for activation and has no agreement yet.`, act: 'agreement' })),
    ...rows.filter((r) => r.status === 'active' && (!r.last_sale || Date.now() - new Date(r.last_sale) > 7 * 864e5) && Date.now() - new Date(r.created_at) > 7 * 864e5)
      .map((r) => ({ r, key: `q${r.id}`, text: `${r.name} has not sold anything in over a week${r.owner_phone ? `. Call ${r.owner_name || 'the owner'} on ${r.owner_phone}` : ''}.`, act: 'call' })),
  ].slice(0, 8);

  const trend = (now, before) => {
    if (!before) return null;
    const pct = Math.round(((now - before) / before) * 100);
    return <span className={`trend ${pct >= 0 ? 'up' : 'down'}`}>{pct >= 0 ? '+' : ''}{pct}%</span>;
  };

  return (
    <>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Uzaa admin</h1>
        <button className="btn primary" onClick={() => setOnboard(true)}>Onboard a client</button>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      <div className="kpis">
        <div className="kpi"><div className="v">{rows.length}</div><div className="l">Clients</div><div className="s">{waiting} waiting for activation</div></div>
        <div className="kpi"><div className="v">{active}</div><div className="l">Sold something in the last 7 days</div></div>
        {hasPerf
          ? <div className="kpi"><div className="v">{money(month)}</div><div className="l">Revenue across all, last 30 days</div><div className="s">{trend(month, prev) || 'No earlier month yet'}{prev ? ' vs the 30 days before' : ''}</div></div>
          : <div className="kpi"><div className="v">{money(week)}</div><div className="l">Revenue across all, last 7 days</div></div>}
        {hasPerf
          ? <div className="kpi"><div className="v">{money(sum('revenue_today'))}</div><div className="l">Sold today, all clients</div><div className="s">{num(sum('sales_today'))} sales</div></div>
          : <div className="kpi"><div className="v">{num(sum('sales_count'))}</div><div className="l">Total sales recorded</div></div>}
        <div className="kpi"><div className="v">{agrs ? unsigned : '-'}</div><div className="l">Agreements waiting for a signature</div></div>
      </div>

      {!hasPerf && rows.length > 0 && <div className="note small">Run <b>supabase/security-patch-12.sql</b> in Supabase to see 30-day performance, today&apos;s sales and agreement status here.</div>}

      {attention.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 4 }}>Needs your attention</h2>
          {attention.map((x) => (
            <div key={x.key} className="attn">
              <span className="small">{x.text}</span>
              {x.act === 'activate' && <button className="btn small primary" onClick={() => toggle(x.r)}>Activate</button>}
              {x.act === 'remind' && <button className="btn small" onClick={() => setSend({ agreement: x.a, title: 'Remind them to sign' })}>Remind</button>}
              {x.act === 'agreement' && <button className="btn small" onClick={() => setNewAgr(x.r)}>Send agreement</button>}
              {x.act === 'call' && x.r.owner_phone && <a className="btn small" href={`tel:${x.r.owner_phone.replace(/\s/g, '')}`}>Call</a>}
            </div>
          ))}
        </div>
      )}

      <div className="admintabs" role="tablist">
        {[['businesses', `Clients (${rows.length})`], ['agreements', `Agreements${agrs ? ` (${agrs.length})` : ''}`], ['team', 'Sales team']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
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

      {onboard && (
        <OnboardClient
          onClose={() => setOnboard(false)}
          onDone={(res, f) => {
            setOnboard(false); load(); loadAgrs();
            if (res.agreement) setSend({ agreement: res.agreement, title: `${f.name} is onboarded`, note: `${f.owner_name} has been emailed a link to set their password. Now send them the agreement to sign.` });
            else alert(res.warning || `${f.name} is set up. ${f.owner_name} has been emailed a link to set their password.`);
          }}
        />
      )}
      {newAgr && (
        <NewAgreement business={newAgr} onClose={() => setNewAgr(null)}
          onDone={(a) => { setNewAgr(null); loadAgrs(); load(); setSend({ agreement: a, title: 'Agreement ready' }); }} />
      )}
      {send && <SendAgreement {...send} onClose={() => setSend(null)} />}

      {tab === 'team' && <SalesTeam />}

      {tab === 'agreements' && (
        <AgreementList rows={agrs} err={agrErr} onSend={(a) => setSend({ agreement: a })}
          onChanged={(a, action) => { loadAgrs(); load(); if (action === 'relink') setSend({ agreement: a, title: 'New link ready' }); }} />
      )}

      {tab === 'businesses' && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="input grow" placeholder="Search a business, owner, email or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clients" />
            <select className="input" style={{ width: 'auto' }} value={show} onChange={(e) => setShow(e.target.value)} aria-label="Status">
              <option value="all">All</option><option value="active">Active</option><option value="pending">Waiting</option><option value="suspended">Suspended</option>
            </select>
          </div>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Business</th><th>Owner</th><th className="num">Today</th><th className="num">7 days</th><th className="num">30 days</th><th className="num">Sales</th><th>Last sale</th><th>Agreement</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id}>
                    <td><b>{b.name}</b><div className="small muted">{b.business_type} &middot; {b.branches} branch{Number(b.branches) === 1 ? '' : 'es'} &middot; {b.staff} login{Number(b.staff) === 1 ? '' : 's'}</div><div className="small muted">Joined {fmtDate(b.created_at)}</div></td>
                    <td>
                      {b.owner_name && <div>{b.owner_name}</div>}
                      <div className="small">{b.owner_email}</div>
                      {b.owner_phone && <div className="small">{b.owner_phone}</div>}
                      <div className="small muted">{b.agent_name ? `signed by ${b.agent_name}` : 'onboarded by Uzaa'}{b.owner_joined === false ? ' · has not signed in yet' : ''}</div>
                      {Number(b.staff) === 0 && <div className="small warn">No login left for this business</div>}
                    </td>
                    <td className="num">{hasPerf ? money(b.revenue_today) : '-'}</td>
                    <td className="num">{money(b.revenue_7d)}</td>
                    <td className="num">{hasPerf ? <>{money(b.revenue_30d)}<div>{trend(Number(b.revenue_30d), Number(b.revenue_prev_30d))}</div></> : '-'}</td>
                    <td className="num">{num(b.sales_count)}</td>
                    <td>{b.last_sale ? fmtDate(b.last_sale) : 'Never'}</td>
                    <td>
                      {b.agreement_status ? <span className={`badge ${AGR[b.agreement_status]?.cls || ''}`}>{AGR[b.agreement_status]?.label}</span> : <span className="small muted">None</span>}
                    </td>
                    <td>
                      {b.status === 'active' && <span className="badge">Active</span>}
                      {b.status === 'pending' && <span className="badge amber">Waiting for activation</span>}
                      {b.status === 'suspended' && <span className="badge red">Suspended</span>}
                    </td>
                    <td className="right">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6, flexWrap: 'nowrap' }}>
                        <button className={`btn small ${b.status === 'active' ? 'danger' : 'primary'}`} onClick={() => toggle(b)}>{b.status === 'active' ? 'Suspend' : b.status === 'pending' ? 'Activate' : 'Reactivate'}</button>
                        <button className="btn small" onClick={() => setNewAgr(b)}>Agreement</button>
                        <button className="btn small danger" onClick={() => askDelete(b)}>Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan="10" className="muted">{rows.length ? 'Nothing matches that.' : 'No clients yet. Press "Onboard a client".'}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
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
      <div className="row between" style={{ margin: '0 0 8px' }}>
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
