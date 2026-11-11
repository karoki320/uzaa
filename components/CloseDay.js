'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { post } from '@/lib/api';
import { money } from '@/lib/util';
import Modal from './Modal';

// Closing the day: count the cash in the drawer, Uzaa compares it with what should be there and tells the owner.
export default function CloseDay({ business, branchId, day, onClose, onDone }) {
  const cur = business.currency;
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState(null);

  async function save(e) {
    e.preventDefault();
    const n = Number(String(counted).replace(/,/g, ''));
    if (counted === '' || !(n >= 0)) return setErr('Type the cash you counted');
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('close_day', { p_branch: branchId, p_day: day, p_counted: n, p_note: note.trim() });
    setBusy(false);
    if (error) return setErr(/function .*close_day/i.test(error.message) ? 'Run security-patch-14.sql in Supabase first.' : error.message);
    setRes(data);
    post('/api/close/notify', { id: data.id });   // the owner's phone
    onDone?.(data);
  }

  if (res) {
    const d = Number(res.diff);
    return (
      <Modal title="Day closed" onClose={onClose}>
        <div className="hero" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, background: d === 0 ? 'linear-gradient(150deg, #2E6E69, #1D4A46)' : undefined }}>
          <span className="k">{d === 0 ? 'Balanced' : d < 0 ? 'Short' : 'Over'}</span>
          <div className="big">{d === 0 ? money(res.counted, cur) : money(Math.abs(d), cur)}</div>
          <p>{d === 0 ? 'The cash matches exactly. Well done.' : d < 0 ? 'There is less cash than there should be.' : 'There is more cash than there should be.'}</p>
        </div>
        <Breakdown r={res} cur={cur} />
        <p className="small muted">The owner has been told. You can count again: the last count stands.</p>
        <button className="btn primary" style={{ width: '100%' }} onClick={onClose}>Done</button>
      </Modal>
    );
  }

  return (
    <Modal title="Close the day" onClose={onClose}>
      <form onSubmit={save}>
        <p className="muted" style={{ marginTop: 0 }}>Count the notes and coins in the drawer and type the total. Leave out any float (change money) you started the day with.</p>
        <label className="field"><span>Cash counted ({cur})</span>
          <input className="input" inputMode="decimal" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0" style={{ fontSize: 24, fontWeight: 800 }} />
        </label>
        <label className="field"><span>Note (optional)</span>
          <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Gave KES 200 change from my pocket" />
        </label>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Checking...' : 'Close the day'}</button>
      </form>
    </Modal>
  );
}

export function Breakdown({ r, cur }) {
  const line = (l, v, strong) => <div className="row between" style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.7)' }}><span className={strong ? '' : 'muted'}>{l}</span>{strong ? <b>{v}</b> : <span>{v}</span>}</div>;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      {line('Cash sales', money(r.cash_sales, cur))}
      {Number(r.cash_paid_in) > 0 && line('Credit paid back in cash', money(r.cash_paid_in, cur))}
      {Number(r.cash_spent) > 0 && line('Cash expenses', `-${money(r.cash_spent, cur)}`)}
      {line('Should be in the drawer', money(r.expected, cur), true)}
      {line('Counted', money(r.counted, cur), true)}
      {r.note ? <p className="small" style={{ margin: '8px 0 0' }}>Note: {r.note}</p> : null}
    </div>
  );
}
