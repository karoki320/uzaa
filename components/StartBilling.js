'use client';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';
import { money } from '@/lib/util';
import PayButton from '@/components/PayButton';

const CHOICE = { week: 'Weekly', month: 'Monthly', quarter: 'Every 3 months' };

// Shown to the owner of a business that is waiting for its first payment (chose "Pay now" at sign-up,
// or signed an agreement). Pay, change how often, or take the one-time free trial instead.
export default function StartBilling({ onStarted }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = async () => {
    try {
      const r = await fetch('/api/billing', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      setD(r.ok ? j : { none: true });
    } catch { setD({ none: true }); }
  };
  useEffect(() => { load(); }, []);

  async function setPeriod(period) {
    setErr('');
    const r = await post('/api/billing', { action: 'period', period });
    if (!r.ok) return setErr(r.data.error || 'Could not change that');
    load();
  }
  async function trial() {
    setBusy(true); setErr('');
    const r = await post('/api/billing', { action: 'trial' });
    if (!r.ok) { setBusy(false); return setErr(r.data.error || 'Could not start the free trial'); }
    onStarted?.();
  }

  if (!d) return <p className="muted small">Loading your plan...</p>;
  const sub = d.sub;
  if (d.none || !d.owner || !sub || !(sub.fee > 0) || d.standing?.state !== 'unpaid') return null;
  return (
    <div style={{ marginTop: 6 }}>
      {sub.can_switch && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {Object.entries(sub.prices).map(([p, amt]) => (
            <button key={p} className={`btn small ${sub.period === p ? 'primary' : ''}`} aria-pressed={sub.period === p} onClick={() => sub.period !== p && setPeriod(p)}>
              {CHOICE[p] || p}: {money(amt, sub.currency)}
            </button>
          ))}
        </div>
      )}
      {d.online
        ? <PayButton endpoint="/api/billing" label={`Pay ${money(sub.next.amount, sub.currency)} and start selling`} />
        : <p className="warn small">Online payment is not switched on yet. Please contact Uzaa.</p>}
      {sub.can_trial && (
        <button className="btn" style={{ width: '100%', marginTop: 10 }} onClick={trial} disabled={busy}>
          {busy ? 'Starting...' : `Try Uzaa free for ${sub.trial_days} days instead`}
        </button>
      )}
      {err && <p className="small warn" role="alert">{err}</p>}
    </div>
  );
}
