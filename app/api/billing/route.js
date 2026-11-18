import { bad, ok, adminClient, userClient, serverReady, sameOrigin, readJson, clientIp, logEvent } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { standing, nextCharge, startCheckout, trialEnd, GRACE_DAYS } from '@/lib/billing';
import { TRIAL_DAYS } from '@/lib/plans';
import { paystackReady, paystackTest } from '@/lib/paystack';
import { PERIODS, PLANS, listPrice, onList } from '@/lib/plans';

export const dynamic = 'force-dynamic';

// The signed-in person's business. Read with the service role on purpose: a locked (lapsed) business
// cannot read anything through row level security, but its owner must still be able to pay.
async function caller(sb) {
  const me = await userClient();
  const { data } = await me.auth.getUser();
  if (!data?.user) return null;
  const { data: p } = await sb.from('profiles').select('id,role,active,email,business_id').eq('id', data.user.id).maybeSingle();
  if (!p || !p.active || !p.business_id) return null;
  const { data: biz } = await sb.from('businesses').select('id,name,status').eq('id', p.business_id).maybeSingle();
  return biz ? { p, biz } : null;
}

// A free trial is offered once: to a price-list business that is still waiting for its first payment
// and has never had a trial or a payment.
async function canTrial(sb, sub, biz) {
  // Clients on a signed agreement pay as agreed: no trial for them.
  if (!sub || !onList(sub) || sub.agreement_id || sub.paid_until || biz.status !== 'pending') return false;
  const { count } = await sb.from('billing_payments').select('id', { count: 'exact', head: true }).eq('business_id', biz.id).eq('status', 'success');
  return !count;
}

export async function GET() {
  if (!serverReady()) return bad('Server is not set up', 500);
  const sb = adminClient();
  const c = await caller(sb);
  if (!c) return bad('Not signed in', 401);
  const { data: sub } = await sb.from('subscriptions').select('*').eq('business_id', c.biz.id).maybeSingle();
  const st = standing(sub, c.biz.status);
  const owner = c.p.role === 'owner';
  if (!owner) return ok({ owner: false, standing: st, grace: GRACE_DAYS });
  const { data: pays } = await sb.from('billing_payments')
    .select('reference,kind,amount,currency,status,channel,covers_from,covers_to,paid_at,created_at')
    .eq('business_id', c.biz.id).neq('status', 'pending').order('created_at', { ascending: false }).limit(24);
  return ok({
    owner: true, standing: st, grace: GRACE_DAYS, online: paystackReady(), test: paystackTest(),
    sub: sub ? {
      plan: sub.plan, fee: Number(sub.fee), period: sub.period, setup_fee: Number(sub.setup_fee), setup_paid: sub.setup_paid,
      currency: sub.currency, paid_until: sub.paid_until, auto_renew: sub.auto_renew && !!sub.card_auth, card_label: sub.card_auth ? sub.card_label : '',
      next: nextCharge(sub), trial_ends: sub.trial_ends,
      can_switch: onList(sub), prices: onList(sub) ? PLANS.standard.prices : null,
      can_trial: await canTrial(sb, sub, c.biz), trial_days: TRIAL_DAYS,
    } : null,
    payments: pays || [],
  });
}

// { action: 'pay', save_card } opens a Paystack checkout. { action: 'card_off' } stops automatic renewals.
export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const sb = adminClient();
  const c = await caller(sb);
  if (!c) return bad('Not signed in', 401);
  if (c.p.role !== 'owner') return bad('Only the business owner can manage billing', 403);
  if (c.biz.status === 'suspended') return bad('This account is suspended. Please contact Uzaa support.', 403);
  const b = await readJson(req);
  const { data: sub } = await sb.from('subscriptions').select('*').eq('business_id', c.biz.id).maybeSingle();
  if (!sub || !(Number(sub.fee) > 0)) return bad('Billing is not set up for your business yet. Please contact Uzaa.');

  if (b.action === 'card_off') {
    await sb.from('subscriptions').update({ auto_renew: false, card_auth: '', card_label: '', card_email: '', updated_at: new Date().toISOString() }).eq('business_id', c.biz.id);
    await logEvent(sb, 'billing_card_removed', { email: c.p.email, ip: clientIp(req), success: true });
    return ok({});
  }
  // Switch between weekly, monthly and every 3 months (price-list clients only). Applies from the next payment:
  // the paid-up date does not move, so nobody pays twice for the same days.
  if (b.action === 'period') {
    if (!onList(sub)) return bad('Your price was set by Uzaa. Please contact Uzaa to change how often you pay.');
    if (!PERIODS.includes(b.period)) return bad('Choose weekly, monthly or every 3 months');
    await sb.from('subscriptions').update({ period: b.period, fee: listPrice('standard', b.period), updated_at: new Date().toISOString() }).eq('business_id', c.biz.id);
    return ok({});
  }
  if (b.action === 'trial') {
    if (!(await canTrial(sb, sub, c.biz))) return bad('The free trial is not available for this account.');
    const ends = trialEnd();
    await sb.from('subscriptions').update({ paid_until: ends, trial_ends: ends, updated_at: new Date().toISOString() }).eq('business_id', c.biz.id);
    await sb.from('businesses').update({ status: 'active' }).eq('id', c.biz.id).eq('status', 'pending');
    await logEvent(sb, 'billing_trial_started', { email: c.p.email, ip: clientIp(req), success: true });
    return ok({ trial_ends: ends });
  }
  if (b.action !== 'pay') return bad('Bad request');
  const l = await hit('billingpay', `u:${c.p.id}`, { limit: 10, window: 900 }); if (l) return l;
  try {
    const url = await startCheckout(sb, req, { sub, kind: sub.paid_until || sub.setup_paid ? 'renewal' : 'first', email: sub.bill_email || c.p.email, saveCard: b.save_card === true });
    return ok({ url });
  } catch (e) { return bad(e.message || 'Could not start the payment'); }
}
