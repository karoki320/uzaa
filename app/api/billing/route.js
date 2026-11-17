import { bad, ok, adminClient, userClient, serverReady, sameOrigin, readJson, clientIp, logEvent } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { standing, nextCharge, startCheckout, GRACE_DAYS } from '@/lib/billing';
import { paystackReady, paystackTest } from '@/lib/paystack';

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
      next: nextCharge(sub),
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
  if (b.action !== 'pay') return bad('Bad request');
  const l = await hit('billingpay', `u:${c.p.id}`, { limit: 10, window: 900 }); if (l) return l;
  try {
    const url = await startCheckout(sb, req, { sub, kind: sub.paid_until || sub.setup_paid ? 'renewal' : 'first', email: sub.bill_email || c.p.email, saveCard: b.save_card === true });
    return ok({ url });
  } catch (e) { return bad(e.message || 'Could not start the payment'); }
}
