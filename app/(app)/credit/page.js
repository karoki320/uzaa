'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { money, fmtDate, waLink } from '@/lib/util';
import Modal from '@/components/Modal';

export default function Credit() {
  const { business, profile, session } = useAuth();
  const cur = business.currency;
  const canEdit = profile.role === 'owner' || profile.role === 'manager';
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);      // the customer being looked at
  const [add, setAdd] = useState(null);        // { name, phone }
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('customer_debts').select('*').order('balance', { ascending: false }).range(0, 999);
    if (error) return setErr(error.message);
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => r.name.toLowerCase().includes(t) || (r.phone || '').includes(t)) : rows;
  }, [rows, q]);
  const owed = rows.reduce((s, r) => s + Number(r.balance || 0), 0);
  const owing = rows.filter((r) => Number(r.balance) > 0).length;

  async function saveCustomer() {
    const name = add.name.trim();
    if (!name) return setErr('Enter the name');
    setBusy(true); setErr('');
    const { error } = await supabase.from('customers').insert({
      business_id: business.id, name: name.slice(0, 80), phone: add.phone.trim().slice(0, 20),
    });
    setBusy(false);
    if (error) return setErr(/duplicate|unique/i.test(error.message) ? 'That number is already saved for another customer' : error.message);
    setAdd(null); load();
  }

  if (!business.credit_enabled) {
    return (
      <div className="card">
        <h2>Credit sales are switched off</h2>
        <p className="muted">
          {profile.role === 'owner'
            ? 'Open Settings and turn on credit sales to start recording who owes you.'
            : 'Ask the business owner to turn on credit sales in Settings.'}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1>Credit</h1>
        <button className="btn primary" onClick={() => { setAdd({ name: '', phone: '' }); setErr(''); }}>Add a customer</button>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="v">{money(owed, cur)}</div><div className="l">Owed to you</div></div>
        <div className="kpi"><div className="v">{owing}</div><div className="l">People owing</div></div>
      </div>

      <input className="input" style={{ marginBottom: 12 }} placeholder="Search a name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
      {err && <div className="err">{err}</div>}

      <div className="card">
        {list.length === 0 && <p className="muted" style={{ margin: 0 }}>{rows.length ? 'Nobody matches that.' : 'No customers yet. Add one, or choose Credit at the till.'}</p>}
        {list.map((r) => (
          <button key={r.id} className="debtrow" onClick={() => setOpen(r)}>
            <div>
              <b>{r.name}</b>
              <div className="small muted">{r.phone || 'No number'}{r.last_sale ? ` · last ${fmtDate(r.last_sale)}` : ''}</div>
            </div>
            <div className={`amt ${Number(r.balance) > 0 ? 'owing' : 'clear'}`}>
              {Number(r.balance) > 0 ? money(r.balance, cur) : 'Cleared'}
            </div>
          </button>
        ))}
      </div>

      {add && (
        <Modal title="Add a customer" onClose={() => setAdd(null)}>
          <label className="field"><span>Name</span><input className="input" autoFocus value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></label>
          <label className="field"><span>Phone number (for reminders)</span><input className="input" inputMode="tel" placeholder="0722 000 111" value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} /></label>
          {err && <div className="err">{err}</div>}
          <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={saveCustomer}>{busy ? 'Saving...' : 'Save customer'}</button>
        </Modal>
      )}

      {open && (
        <CustomerSheet
          row={open} cur={cur} canEdit={canEdit} business={business} userId={session?.user?.id}
          onClose={() => setOpen(null)} onChanged={() => { load(); setOpen(null); }}
        />
      )}
    </>
  );
}

function CustomerSheet({ row, cur, canEdit, business, userId, onClose, onChanged }) {
  const [sales, setSales] = useState([]);
  const [pays, setPays] = useState([]);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState((business.payment_methods || ['Cash'])[0]);
  const [limit, setLimit] = useState(row.credit_limit ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('sales').select('id,receipt_no,total,amount_paid,created_at').eq('customer_id', row.id).eq('payment_method', 'Credit')
      .order('created_at', { ascending: false }).limit(50).then(({ data }) => setSales(data || []));
    supabase.from('credit_payments').select('*').eq('customer_id', row.id)
      .order('created_at', { ascending: false }).limit(50).then(({ data }) => setPays(data || []));
  }, [row.id]);

  const balance = Number(row.balance || 0);
  const msg = `Hello ${row.name}, this is ${business.name}. Your balance with us is ${money(balance, cur)}. Thank you.`;
  const wa = waLink(row.phone, msg);

  async function pay() {
    const a = Number(amount);
    if (!(a > 0)) return setErr('Enter the amount they paid');
    if (a > balance) return setErr(`That is more than the ${money(balance, cur)} they owe`);
    setBusy(true); setErr('');
    const { error } = await supabase.from('credit_payments').insert({
      business_id: business.id, customer_id: row.id, amount: a, method, user_id: userId,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    onChanged();
  }

  async function saveLimit() {
    setBusy(true); setErr('');
    const v = limit === '' ? null : Math.max(0, Number(limit) || 0);
    const { error } = await supabase.from('customers').update({ credit_limit: v }).eq('id', row.id);
    setBusy(false);
    if (error) return setErr(error.message);
    onChanged();
  }

  return (
    <Modal title={row.name} onClose={onClose}>
      <div className="tint" style={{ marginBottom: 12 }}>
        <b style={{ fontSize: 22 }}>{balance > 0 ? `${money(balance, cur)} owed` : 'Nothing owed'}</b>
        <div className="small muted">{row.phone || 'No number saved'} &middot; limit {Number(row.credit_limit) > 0 ? money(row.credit_limit, cur) : 'none'}</div>
      </div>

      {balance > 0 && (
        <>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field grow" style={{ marginBottom: 0 }}><span>They paid</span>
              <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(balance)} />
            </label>
            <label className="field" style={{ marginBottom: 0, width: 140 }}><span>By</span>
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                {(business.payment_methods || ['Cash']).filter((m) => m.toLowerCase() !== 'credit').map((m) => <option key={m}>{m}</option>)}
              </select>
            </label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary grow" disabled={busy} onClick={pay}>{busy ? 'Saving...' : 'Record payment'}</button>
            <button className="btn" disabled={busy} onClick={() => { setAmount(String(balance)); }}>Paid all</button>
          </div>
          {wa && <a className="btn" href={wa} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 10, lineHeight: '28px' }}>Remind on WhatsApp</a>}
        </>
      )}
      {err && <div className="err">{err}</div>}

      {canEdit && (
        <div className="row" style={{ alignItems: 'flex-end', marginTop: 14 }}>
          <label className="field grow" style={{ marginBottom: 0 }}><span>Credit limit for this customer (empty uses the shop limit)</span>
            <input className="input" inputMode="decimal" value={limit ?? ''} onChange={(e) => setLimit(e.target.value)} />
          </label>
          <button className="btn" disabled={busy} onClick={saveLimit}>Save</button>
        </div>
      )}

      <h3 style={{ marginBottom: 6 }}>Taken on credit</h3>
      {sales.length === 0 && <p className="muted small" style={{ marginTop: 0 }}>Nothing yet.</p>}
      {sales.map((s) => (
        <div key={s.id} className="pendrow">
          <div><b>#{s.receipt_no}</b><div className="small muted">{fmtDate(s.created_at)}</div></div>
          <div style={{ textAlign: 'right' }}>
            <b>{money(s.total, cur)}</b>
            {Number(s.amount_paid) > 0 && <div className="small muted">deposit {money(s.amount_paid, cur)}</div>}
          </div>
        </div>
      ))}

      <h3 style={{ marginBottom: 6 }}>Payments</h3>
      {pays.length === 0 && <p className="muted small" style={{ marginTop: 0 }}>None yet.</p>}
      {pays.map((p) => (
        <div key={p.id} className="pendrow">
          <div><b>{money(p.amount, cur)}</b><div className="small muted">{p.method}</div></div>
          <div className="small muted">{fmtDate(p.created_at)}</div>
        </div>
      ))}
    </Modal>
  );
}
