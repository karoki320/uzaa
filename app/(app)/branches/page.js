'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import Modal from '@/components/Modal';

export default function Branches() {
  const { business, branches, reload } = useAuth();
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const row = { name: edit.name.trim(), address: edit.address || '', phone: edit.phone || '' };
    const { error } = edit.id
      ? await supabase.from('branches').update(row).eq('id', edit.id)
      : await supabase.from('branches').insert({ ...row, business_id: business.id });
    setBusy(false);
    if (error) return setErr(error.message);
    setEdit(null);
    reload();
  }

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1>Branches</h1>
        <button className="btn primary" onClick={() => { setEdit({ name: '', address: '', phone: '' }); setErr(''); }}>Add branch</button>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Address</th><th>Phone</th><th></th></tr></thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id}>
                <td><b>{b.name}</b></td><td>{b.address || '-'}</td><td>{b.phone || '-'}</td>
                <td className="right"><button className="btn small" onClick={() => { setEdit(b); setErr(''); }}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Each branch keeps its own stock. Assign cashiers to a branch in Staff.</p>
      {edit && (
        <Modal title={edit.id ? 'Edit branch' : 'Add branch'} onClose={() => setEdit(null)}>
          <form onSubmit={save}>
            <label className="field"><span>Name</span><input className="input" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="field"><span>Address (printed on receipts)</span><input className="input" value={edit.address || ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></label>
            <label className="field"><span>Phone</span><input className="input" value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
            {err && <div className="err">{err}</div>}
            <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
          </form>
        </Modal>
      )}
    </>
  );
}
