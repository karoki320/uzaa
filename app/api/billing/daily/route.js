import { NextResponse } from 'next/server';
import { adminClient, serverReady } from '@/lib/server';
import { chargeCard, newRef, paystackReady } from '@/lib/paystack';
import { settle, tellOwners, today, daysBetween, longDate, GRACE_DAYS } from '@/lib/billing';
import { money } from '@/lib/util';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Once a day at 08:00 Nairobi (05:00 UTC, see vercel.json). Only the scheduler can call it (CRON_SECRET).
//  1. charges saved cards that are due (once a day, on the due date and through the grace period)
//  2. locks businesses more than GRACE_DAYS past their paid-up date
//  3. reminds owners on their phone: 5 days before, 1 day before, on the day, and during the grace period
export async function GET(req) {
  if (!serverReady()) return NextResponse.json({ ok: false, reason: 'not set up' }, { status: 503 });
  const secret = process.env.CRON_SECRET || '';
  if (!secret || (req.headers.get('authorization') || '') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });

  const sb = adminClient();
  const day = today();
  const out = { charged: 0, failed: 0, locked: 0, reminded: 0 };

  const { data: subs } = await sb.from('subscriptions')
    .select('business_id,plan,fee,period,currency,paid_until,auto_renew,card_auth,card_email,last_auto_try,setup_paid,setup_fee,trial_ends')
    .gt('fee', 0).not('paid_until', 'is', null);
  const ids = (subs || []).map((s) => s.business_id);
  const { data: bizs } = ids.length ? await sb.from('businesses').select('id,status').in('id', ids) : { data: [] };
  const status = Object.fromEntries((bizs || []).map((b) => [b.id, b.status]));

  for (const s of subs || []) {
    const left = daysBetween(day, s.paid_until);
    const st = status[s.business_id];
    if (st === 'suspended' || st === 'pending' || !st) continue;

    // 1. automatic card renewal
    if (paystackReady() && s.auto_renew && s.card_auth && left <= 0 && s.last_auto_try !== day && -left <= GRACE_DAYS + 30) {
      await sb.from('subscriptions').update({ last_auto_try: day }).eq('business_id', s.business_id);
      const reference = newRef('A');
      const amount = Number(s.fee) + (!s.setup_paid && Number(s.setup_fee) > 0 ? Number(s.setup_fee) : 0);
      const { error } = await sb.from('billing_payments').insert({ business_id: s.business_id, reference, kind: 'auto', amount, currency: s.currency, includes_setup: !s.setup_paid && Number(s.setup_fee) > 0 });
      if (!error) {
        let res = null;
        try {
          await chargeCard({ email: s.card_email, amount, currency: s.currency, authorization_code: s.card_auth, reference, metadata: { business_id: s.business_id, kind: 'auto' } });
          res = await settle(sb, reference);
        } catch (e) {
          await sb.from('billing_payments').update({ status: 'failed', note: String(e.message || '').slice(0, 200) }).eq('reference', reference);
        }
        if (res?.status === 'success') { out.charged += 1; continue; }
        out.failed += 1;
        await tellOwners(sb, s.business_id, { title: 'Uzaa could not charge your card', body: `Renew ${s.plan} (${money(amount, s.currency)}) with M-Pesa or another card under Billing.`, url: '/billing', tag: 'billing' });
        continue;
      }
    }

    // 3. reminders (a saved card that will be charged gets a gentler note)
    const auto = s.auto_renew && s.card_auth;
    let msg = null;
    const ahead = s.trial_ends ? [3, 1] : s.period === 'week' ? [2] : [5, 1];
    if (ahead.includes(left)) msg = auto ? null : s.trial_ends
      ? { title: `Your free Uzaa trial ends in ${left} day${left === 1 ? '' : 's'}`, body: `Keep selling: pay ${money(s.fee, s.currency)} under Billing with M-Pesa or card. Weekly, monthly or every 3 months.` }
      : { title: `Uzaa renews in ${left} day${left === 1 ? '' : 's'}`, body: `${s.plan}: ${money(s.fee, s.currency)} due on ${longDate(s.paid_until)}. Pay with M-Pesa or card under Billing.` };
    else if (left === 0) msg = auto ? null : { title: s.trial_ends ? 'Your free Uzaa trial ends today' : 'Uzaa renewal due today', body: `Pay ${money(s.fee, s.currency)} under Billing to keep selling without interruption.` };
    else if (left < 0 && st === 'active') {
      const lockIn = GRACE_DAYS + left + 1;
      if (lockIn === GRACE_DAYS || lockIn === 3 || lockIn === 1) msg = { title: 'Uzaa payment overdue', body: `Your till locks in ${lockIn} day${lockIn === 1 ? '' : 's'} unless you renew. Pay under Billing.` };
    }
    if (msg) { await tellOwners(sb, s.business_id, { ...msg, url: '/billing', tag: 'billing' }); out.reminded += 1; }
  }

  // 2. lock the unpaid ones
  const { data: locked } = await sb.rpc('billing_lapse', { p_grace: GRACE_DAYS });
  for (const id of locked || []) {
    out.locked += 1;
    await tellOwners(sb, id, { title: 'Uzaa is locked', body: 'Your subscription is unpaid. Open Uzaa and pay with M-Pesa or card to unlock it straight away. Your data is safe.', url: '/billing', tag: 'billing' });
  }
  return NextResponse.json({ ok: true, day, ...out }, { headers: { 'Cache-Control': 'no-store' } });
}
