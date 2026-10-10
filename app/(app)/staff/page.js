'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import Modal from '@/components/Modal';
import PasswordField from '@/components/PasswordField';

export default function Staff() {
  const { branches, profile } = useAuth();
  const [rows, setRows] = useState([]);
  const [add, setAdd] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [pwFor, setPwFor] = useState(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at');
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function call(method, body) {
    const res = await fetch('/api/staff', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Request failed');
    return j;
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const j = await call('POST', add);
      setAdd(null);
      setToast(j.invited ? `Invite sent to ${add.email}. They open the email and choose their own password.` : 'Account created.');
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
        <button className="btn primary" onClick={() => { setAdd({ full_name: '', email: '', password: '', mode: 'invite', role: 'cashier', branch_id: branches[0]?.id }); setErr(''); }}>Add staff</button>
      </div>
      {toast && <div className="note" role="status">{toast}</div>}
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
                        <button className="btn small" onClick={async () => { try { await call('PATCH', { id: r.id, send_link: true }); setToast(`Link sent to ${r.email}.`); } catch (ex) { alert(ex.message); } }}>Email a link</button>{' '}
                        <button className="btn small" onClick={() => { setPwFor({ id: r.id, email: r.email, password: '' }); setErr(''); }}>Set password</button>{' '}
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

      {pwFor && (
        <Modal title="Set a password" onClose={() => setPwFor(null)}>
          <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await call('PATCH', { id: pwFor.id, password: pwFor.password }); setPwFor(null); setToast('Password changed.'); } catch (ex) { setErr(ex.message); } setBusy(false); }}>
            <p className="muted small">{pwFor.email}</p>
            <PasswordField value={pwFor.password} onChange={(v) => setPwFor({ ...pwFor, password: v })} email={pwFor.email} label="New password" />
            {err && <div className="err">{err}</div>}
            <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Saving...' : 'Save password'}</button>
          </form>
        </Modal>
      )}

      {add && (
        <Modal title="Add staff" onClose={() => setAdd(null)}>
          <form onSubmit={create}>
            <label className="field"><span>Full name</span><input className="input" required value={add.full_name} onChange={(e) => setAdd({ ...add, full_name: e.target.value })} /></label>
            <label className="field"><span>Email (their login)</span><input className="input" type="email" required value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></label>
            <div className="field"><span className="lab">How do they get in?</span>
              <div className="row">
                <button type="button" className={`btn small ${add.mode === 'invite' ? 'primary' : ''}`} onClick={() => setAdd({ ...add, mode: 'invite' })}>Email them an invite</button>
                <button type="button" className={`btn small ${add.mode === 'password' ? 'primary' : ''}`} onClick={() => setAdd({ ...add, mode: 'password' })}>I will set a password</button>
              </div>
            </div>
            {add.mode === 'password' && <PasswordField value={add.password} onChange={(v) => setAdd({ ...add, password: v })} email={add.email} label="Password (give it to them)" />}
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
            <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Working...' : add.mode === 'invite' ? 'Send invite' : 'Create account'}</button>
          </form>
        </Modal>
      )}
    </>
  );
}
