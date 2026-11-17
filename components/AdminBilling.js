'use client';
import { useState } from 'react';
import { post } from '@/lib/api';
import { money, fmtDate } from '@/lib/util';
import Modal from '@/components/Modal';

const today = () => new Date().toISOString().slice(0, 10);
const daysTo = (d) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 864e5);

/** Short billing status for the businesses table. */
export function BillingCell({ sub }) {
  if (!sub || !(Number(sub.fee) > 0)) return <span className="small muted">Not set</span>;
  const per = sub.period === 'quarter' ? 'qtr' : sub.period === 'year' ? 'yr' : 'mo';
  const line = <div className="small muted">{money(sub.fee)}/{per}{sub.auto_renew ? ' · auto card' : ''}</div>;
  if (!sub.paid_until) return <><span className="badge amber">Not paid</span>{line}</>;
  const left = daysTo(sub.paid_until);
  return (
    <>
      <span className={`badge ${left < 0 ? 'red' : left <= 5 ? 'amber' : ''}`}>{left < 0 ? `${-left}d overdue` : `to ${fmtDate(sub.paid_until)}`}</span>
      {line}
    </>
  );
}

/** Set a business's plan, price and paid-up date by hand (e.g. paid in cash, or an old client). */
export function BillingModal({ business, sub, payments, onClose, onDone }) {
  const [f, setF] = useState({
    plan: sub?.plan || 'Uzaa POS Standard', fee: sub?.fee ?? '', period: sub?.period || 'month',
    setup_fee: sub?.setup_fee ?? 0, setup_paid: !!sub?.setup_paid, start_date: sub?.start_date || '',
    paid_until: sub?.paid_until || '', bill_email: sub?.bill_email || business.owner_email || '', stop_auto: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function save() {
    setBusy(true); setErr('');
    const r = await post('/api/admin/billing', { ...f, business_id: business.id });
    setBusy(false);
    if (!r.ok) return setErr(r.data.error || 'Could not save');
    onDone();
  }
  const mine = (payments || []).filter((p) => p.business_id === business.id).slice(0, 8);
  return (
    <Modal title={`Billing: ${business.name}`} onClose={onClose}>
      <div className="form">
        <label>Plan<input className="input" value={f.plan} onChange={set('plan')} /></label>
        <div className="row" style={{ gap: 8 }}>
          <label className="grow">Subscription (KES)<input className="input" inputMode="decimal" value={f.fee} onChange={set('fee')} /></label>
          <label className="grow">Every
            <select className="input" value={f.period} onChange={set('period')}><option value="month">Month</option><option value="quarter">Quarter (3 months)</option><option value="year">Year</option></select>
          </label>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="grow">Set-up fee (KES)<input className="input" inputMode="decimal" value={f.setup_fee} onChange={set('setup_fee')} /></label>
          <label className="row small" style={{ gap: 6, alignSelf: 'flex-end', paddingBottom: 10 }}><input type="checkbox" checked={f.setup_paid} onChange={set('setup_paid')} /> Set-up fee paid</label>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="grow">Start date<input className="input" type="date" value={f.start_date || ''} onChange={set('start_date')} /></label>
          <label className="grow">Paid up to<input className="input" type="date" value={f.paid_until || ''} onChange={set('paid_until')} /></label>
        </div>
        <label>Billing email (receipts and Paystack)<input className="input" type="email" value={f.bill_email} onChange={set('bill_email')} /></label>
        {sub?.auto_renew && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.stop_auto} onChange={set('stop_auto')} /> Remove their saved card ({sub.card_label})</label>}
        <p className="small muted">Leave &quot;Paid up to&quot; empty for a client who has not paid yet: they are never locked until a date is set. Set a date in the future to record a payment made outside Paystack; a locked business unlocks at once.</p>
        {err && <p className="warn small">{err}</p>}
        <button className="btn primary" onClick={save} disabled={busy} style={{ width: '100%' }}>{busy ? 'Saving...' : 'Save billing'}</button>
      </div>
      {mine.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Date</th><th className="num">Amount</th><th>How</th><th>Result</th></tr></thead>
            <tbody>
              {mine.map((p) => (
                <tr key={p.reference}>
                  <td>{fmtDate(p.paid_at || p.created_at)}<div className="small muted">{p.reference}</div></td>
                  <td className="num">{money(p.amount, p.currency)}</td>
                  <td>{p.channel === 'mobile_money' ? 'M-Pesa' : p.channel || p.kind}</td>
                  <td>{p.status === 'success' ? <span className="badge">Paid</span> : <span className={`badge ${p.status === 'pending' ? 'amber' : 'red'}`} title={p.note}>{p.status}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
