'use client';
import { useCallback, useEffect, useState } from 'react';
import { post } from '@/lib/api';
import { money, fmtDate } from '@/lib/util';
import PayButton from '@/components/PayButton';

import { PER } from '@/lib/plans';
const CHOICE = { week: 'Weekly', month: 'Monthly', quarter: 'Every 3 months' };
const long = (d) => (d ? new Intl.DateTimeFormat('en-KE', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)) : '');
const KIND = { first: 'Set-up and first period', renewal: 'Renewal', auto: 'Automatic card renewal' };

// The owner's Uzaa subscription: what they pay, when it is due, pay now, and the saved card.
export default function Billing() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/billing', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(j.error || 'Could not load billing');
      setD(j);
    } catch { setErr('No connection'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setPeriod(period) {
    const r = await post('/api/billing', { action: 'period', period });
    if (!r.ok) return alert(r.data.error || 'Could not change how often you pay');
    load();
  }

  async function cardOff() {
    if (!window.confirm('Stop automatic renewals and remove the saved card? You will pay each renewal yourself.')) return;
    const r = await post('/api/billing', { action: 'card_off' });
    if (!r.ok) return alert(r.data.error || 'Could not remove the card');
    load();
  }

  if (err) return <div className="note warn">{err}</div>;
  if (!d) return <div className="muted">Loading...</div>;
  const { sub, standing: st } = d;
  if (!sub || st.state === 'none') return (
    <div className="card"><h2>Billing</h2><p className="muted">Billing is not set up for your business yet. Uzaa will share your plan and price with you.</p></div>
  );

  const label = {
    unpaid: <span className="badge amber">Not paid yet</span>,
    ok: <span className="badge">{st.trial ? 'Free trial' : 'Paid up'}</span>,
    due: <span className="badge amber">{st.trial ? 'Trial ends' : 'Due'} in {st.left} day{st.left === 1 ? '' : 's'}</span>,
    grace: <span className="badge red">Overdue: locks in {st.lockIn} day{st.lockIn === 1 ? '' : 's'}</span>,
    lapsed: <span className="badge red">Locked: unpaid</span>,
  }[st.state];

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Billing</h2>
      {d.test && <div className="note small">Test mode: payments here are not real. Use Paystack test cards or test M-Pesa numbers.</div>}
      <div className="grid" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: 14 }}>
        <div className="kpi"><div className="l">Plan</div><div className="v" style={{ fontSize: 20 }}>{sub.plan}</div><div className="s">{money(sub.fee, sub.currency)} per {PER[sub.period]}</div></div>
        <div className="kpi"><div className="l">{sub.trial_ends ? 'Free trial until' : 'Paid up to'}</div><div className="v" style={{ fontSize: 20 }}>{sub.paid_until ? long(sub.paid_until) : 'Not yet'}</div><div className="s">{label}</div></div>
        <div className="kpi"><div className="l">Renewal</div><div className="v" style={{ fontSize: 20 }}>{sub.auto_renew ? 'Automatic' : 'Pay each time'}</div><div className="s">{sub.auto_renew ? sub.card_label : 'M-Pesa or card'}</div></div>
      </div>

      {sub.can_switch && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ marginTop: 0 }}>How often you pay</h3>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(sub.prices).map(([p, amt]) => (
              <button key={p} className={`btn ${sub.period === p ? 'primary' : ''}`} onClick={() => sub.period !== p && setPeriod(p)} aria-pressed={sub.period === p}>
                {CHOICE[p] || p}: {money(amt, sub.currency)}
              </button>
            ))}
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>A change applies from your next payment. Every 3 months works out cheapest.</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>{sub.trial_ends ? 'Pay to keep using Uzaa after your trial' : sub.paid_until ? 'Renew now' : 'Pay to get started'}</h3>
        <p className="small muted" style={{ marginTop: 0 }}>
          {money(sub.next.amount, sub.currency)}{sub.next.setup ? ` (set-up fee ${money(sub.setup_fee, sub.currency)} + first ${PER[sub.period]})` : ` for one ${PER[sub.period]}`}.
          {sub.paid_until && (st.state === 'ok' || st.state === 'due') ? ` Paying now adds one ${PER[sub.period]} after ${long(sub.paid_until)}, so you lose nothing by paying early${sub.trial_ends ? ' and keep your free days' : ''}.` : ''}
          {st.state === 'lapsed' ? ' Uzaa unlocks as soon as the payment is confirmed.' : ''}
        </p>
        {d.online
          ? <PayButton endpoint="/api/billing" label={`Pay ${money(sub.next.amount, sub.currency)}`} cardOption={!sub.auto_renew} defaultSave={false} />
          : <p className="warn small">Online payment is not switched on yet. Please contact Uzaa to pay.</p>}
        {sub.auto_renew && (
          <p className="small" style={{ marginBottom: 0 }}>
            Your {sub.card_label} is charged automatically on the due date. <button className="btn small" onClick={cardOff}>Stop automatic renewals</button>
          </p>
        )}
      </div>

      <div className="card table-wrap">
        <h3 style={{ marginTop: 0 }}>Payments</h3>
        <table>
          <thead><tr><th>Date</th><th>What</th><th className="num">Amount</th><th>How</th><th>Covers to</th><th>Result</th></tr></thead>
          <tbody>
            {d.payments.map((p) => (
              <tr key={p.reference}>
                <td>{fmtDate(p.paid_at || p.created_at)}</td>
                <td>{KIND[p.kind] || p.kind}<div className="small muted">{p.reference}</div></td>
                <td className="num">{money(p.amount, p.currency)}</td>
                <td>{p.channel === 'mobile_money' ? 'M-Pesa' : p.channel ? p.channel[0].toUpperCase() + p.channel.slice(1) : '-'}</td>
                <td>{p.covers_to ? long(p.covers_to) : '-'}</td>
                <td>{p.status === 'success' ? <span className="badge">Paid</span> : <span className="badge red">{p.status === 'abandoned' ? 'Not completed' : 'Failed'}</span>}</td>
              </tr>
            ))}
            {d.payments.length === 0 && <tr><td colSpan="6" className="muted">No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
