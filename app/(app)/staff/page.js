'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import Modal from '@/components/Modal';

export default function Staff() {
  const { branches, profile } = useAuth();
  const [rows, setRows] = useState([]);
  const [add, setAdd] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at');
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function call(method, body) {
    const { data } = await supabase.auth.getSession();
    const res = await fetch('/api/staff', {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Request failed');
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await call('POST', add);
      setAdd(null);
      load();
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  async function patch(id, body) {
    try { await call('PATCH', { id, ...body }); load(); } catch (ex) { alert(ex.message); }
  }

  const bname = (id) => branches.find((b) => b.id === id)?.name || '-';

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1>Staff</h1>
        <button className="btn primary" onClick={() => { setAdd({ full_name: '', email: '', password: '', role: 'cashier', branch_id: branches[0]?.id }); setErr(''); }}>Add staff</button>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Branch</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const me = r.id === profile.id || r.role === 'owner';
              return (
                <tr key={r.id}>
                  <td><b>{r.full_name}</b></td>
                  <td>{r.email}</td>
                  <td>
                    {me ? <span className="badge">{r.role}</span> : (
                      <select className="input" style={{ minWidth: 120 }} value={r.role} onChange={(e) => patch(r.id, { role: e.target.value })}>
                        <option value="cashier">cashier</option><option value="manager">manager</option>
                      </select>
                    )}
                  </td>
                  <td>
                    {me ? bname(r.branch_id) : (
                      <select className="input" style={{ minWidth: 150 }} value={r.branch_id || ''} onChange={(e) => patch(r.id, { branch_id: e.target.value })}>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td>{r.active ? <span className="badge">Active</span> : <span className="badge red">Disabled</span>}</td>
                  <td className="right">
                    {!me && (
                      <>
                        <button className="btn small" onClick={() => { const p = window.prompt('New password (at least 8 characters)'); if (p) patch(r.id, { password: p }); }}>Reset password</button>{' '}
                        <button className={`btn small ${r.active ? 'danger' : ''}`} onClick={() => patch(r.id, { active: !r.active })}>{r.active ? 'Disable' : 'Enable'}</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">Cashiers only see the Sell and My sales screens for their own branch. Managers also see products, stock and reports.</p>

      {add && (
        <Modal title="Add staff" onClose={() => setAdd(null)}>
          <form onSubmit={create}>
            <label className="field"><span>Full name</span><input className="input" required value={add.full_name} onChange={(e) => setAdd({ ...add, full_name: e.target.value })} /></label>
            <label className="field"><span>Email (their login)</span><input className="input" type="email" required value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></label>
            <label className="field"><span>Password (give it to them)</span><input className="input" required minLength={8} value={add.password} onChange={(e) => setAdd({ ...add, password: e.target.value })} /></label>
            <div className="row">
              <label className="field grow"><span>Role</span>
                <select className="input" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}>
                  <option value="cashier">Cashier</option><option value="manager">Manager</option>
                </select>
              </label>
              <label className="field grow"><span>Branch</span>
                <select className="input" value={add.branch_id} onChange={(e) => setAdd({ ...add, branch_id: e.target.value })}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            </div>
            {err && <div className="err">{err}</div>}
            <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Creating...' : 'Create account'}</button>
          </form>
        </Modal>
      )}
    </>
  );
}
