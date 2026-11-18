'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

// A strip at the top of every screen when the Uzaa subscription is due soon or overdue.
// Owners get a Pay button; staff are asked to tell the owner.
export default function BillingBanner({ role }) {
  const [st, setSt] = useState(null);
  useEffect(() => {
    if (!['owner', 'manager', 'cashier'].includes(role)) return;
    let live = true;
    fetch('/api/billing', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => live && j && setSt(j.standing)).catch(() => {});
    return () => { live = false; };
  }, [role]);
  if (!st || !['due', 'grace', 'unpaid'].includes(st.state)) return null;
  if (st.state === 'unpaid' && role !== 'owner') return null;
  const owner = role === 'owner';
  const text = st.state === 'due'
    ? st.trial
      ? `Your free Uzaa trial ends ${st.left === 0 ? 'today' : `in ${st.left} day${st.left === 1 ? '' : 's'}`}. Pay to keep selling.`
      : `Your Uzaa subscription renews ${st.left === 0 ? 'today' : `in ${st.left} day${st.left === 1 ? '' : 's'}`}.`
    : st.state === 'grace'
      ? `Your Uzaa payment is ${st.overdue} day${st.overdue === 1 ? '' : 's'} overdue. Selling locks in ${st.lockIn} day${st.lockIn === 1 ? '' : 's'}.`
      : 'Your Uzaa subscription is not paid yet.';
  return (
    <div className={`note no-print ${st.state === 'grace' ? 'warn' : ''}`} role="status" style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <span>{text}{owner ? '' : ' Please let the owner know.'}</span>
      {owner && <Link className="btn small primary" href="/billing">Pay now</Link>}
    </div>
  );
}
