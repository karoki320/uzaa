import * as paystack from './paystack';
import { pushReady, sendTo } from './push';
import { PER as PERIOD_LABEL, PLANS, TRIAL_DAYS, listPrice } from './plans';

// Uzaa subscription billing. Server side only.
export const GRACE_DAYS = Math.max(0, Math.min(30, parseInt(process.env.BILLING_GRACE_DAYS || '7', 10) || 7));
export const PER = PERIOD_LABEL;
const round2 = (n) => Math.round(Number(n) * 100) / 100;

export const site = (req) => (process.env.PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/$/, '');

/** Today in Nairobi as YYYY-MM-DD. */
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);

/** Where a business stands: 'none' (no billing set), 'unpaid', 'ok', 'due' (5 days or less), 'grace', 'lapsed'. */
export function standing(sub, bizStatus) {
  if (!sub || !(Number(sub.fee) > 0)) return { state: 'none' };
  if (bizStatus === 'lapsed') return { state: 'lapsed', days: sub.paid_until ? daysBetween(sub.paid_until, today()) : null };
  if (!sub.paid_until) return { state: 'unpaid' };
  const left = daysBetween(today(), sub.paid_until);
  const trial = !!sub.trial_ends;
  if (left < 0) return { state: 'grace', overdue: -left, lockIn: Math.max(0, GRACE_DAYS + left + 1), trial };
  // Weekly payers are reminded 2 days ahead; a 5-day warning would cover most of their week.
  if (left <= (sub.period === 'week' ? 2 : 5) || (trial && left <= 3)) return { state: 'due', left, trial };
  return { state: 'ok', left, trial };
}

/** What the next payment costs: the subscription, plus the set-up fee if it is still owed. */
export function nextCharge(sub) {
  const setup = !sub.setup_paid && Number(sub.setup_fee) > 0;
  return { amount: round2(Number(sub.fee) + (setup ? Number(sub.setup_fee) : 0)), setup };
}

/** Record a pending payment and open a Paystack checkout. Returns the page to send the person to. */
export async function startCheckout(sb, req, { sub, kind, email, saveCard }) {
  if (!paystack.paystackReady()) throw new Error('Online payment is not set up yet. Please contact Uzaa.');
  const { amount, setup } = nextCharge(sub);
  if (!(amount > 0)) throw new Error('No price is set for your plan yet. Please contact Uzaa.');
  const reference = paystack.newRef(kind === 'first' ? 'F' : 'R');
  const { error } = await sb.from('billing_payments').insert({
    business_id: sub.business_id, reference, kind, amount, currency: sub.currency || 'KES',
    includes_setup: setup, save_card: !!saveCard,
  });
  if (error) throw new Error('Could not start the payment. Please try again.');
  const data = await paystack.initialize({
    email, amount, currency: sub.currency || 'KES', reference,
    callback_url: `${site(req)}/pay/done`,
    metadata: {
      business_id: sub.business_id, kind, save_card: !!saveCard,
      cancel_action: `${site(req)}/pay/done?cancelled=1`,
      custom_fields: [{ display_name: 'Plan', variable_name: 'plan', value: `${sub.plan} (per ${PER[sub.period] || sub.period})` }],
    },
  });
  return data.authorization_url;
}

/** Ask Paystack about a payment and apply it if it went through. Safe to call many times. */
export async function settle(sb, reference) {
  const { data: row } = await sb.from('billing_payments').select('*').eq('reference', reference).maybeSingle();
  if (!row) return { status: 'unknown' };
  if (row.status === 'success') {
    const { data: s } = await sb.from('subscriptions').select('paid_until').eq('business_id', row.business_id).maybeSingle();
    return { status: 'success', paid_until: s?.paid_until, business_id: row.business_id, already: true };
  }
  let tx;
  try { tx = await paystack.verify(reference); } catch (e) { return { status: 'pending', error: e.message }; }
  if (tx.status !== 'success') {
    if (['failed', 'abandoned', 'reversed'].includes(tx.status)) {
      await sb.from('billing_payments').update({ status: tx.status === 'abandoned' ? 'abandoned' : 'failed', note: String(tx.gateway_response || '').slice(0, 200) })
        .eq('id', row.id).eq('status', 'pending');
    }
    return { status: tx.status === 'abandoned' ? 'abandoned' : tx.status === 'failed' || tx.status === 'reversed' ? 'failed' : 'pending', message: tx.gateway_response };
  }
  const { data: res, error } = await sb.rpc('billing_apply', {
    p_ref: reference, p_amount: Number(tx.amount) / 100, p_currency: tx.currency, p_channel: tx.channel, p_paid_at: tx.paid_at || null,
  });
  if (error || !res?.ok) return { status: 'failed', message: res?.reason || 'Could not record the payment. Uzaa has been told.' };

  // Keep the card for automatic renewals, only when the client asked for it.
  const a = tx.authorization || {};
  if (row.save_card && a.reusable && a.authorization_code && tx.channel === 'card') {
    await sb.from('subscriptions').update({
      auto_renew: true, card_auth: a.authorization_code, card_email: String(tx.customer?.email || '').toLowerCase(),
      card_label: `${(a.card_type || a.brand || 'Card').trim().replace(/^\w/, (c) => c.toUpperCase())} ending ${a.last4 || '????'}${a.exp_month ? `, expires ${a.exp_month}/${String(a.exp_year || '').slice(-2)}` : ''}`,
      updated_at: new Date().toISOString(),
    }).eq('business_id', row.business_id);
  }
  if (!res.already) await tellOwners(sb, row.business_id, { title: 'Uzaa payment received', body: `Thank you. Your Uzaa subscription is paid up to ${longDate(res.paid_until)}.`, url: '/billing', tag: 'billing' });
  return { status: 'success', paid_until: res.paid_until, business_id: row.business_id };
}

export const longDate = (d) => (d ? new Intl.DateTimeFormat('en-KE', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${String(d).slice(0, 10)}T00:00:00Z`)) : '');

export async function tellOwners(sb, businessId, msg) {
  if (!pushReady()) return;
  try {
    const { data: owners } = await sb.from('profiles').select('id').eq('business_id', businessId).eq('role', 'owner').eq('active', true);
    if (owners?.length) await sendTo(owners.map((o) => o.id), msg);
  } catch {}
}

export function trialEnd() {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + TRIAL_DAYS);
  return d.toISOString().slice(0, 10);
}

/** A business that signed itself up: Uzaa Standard on the period they chose.
 *  trial: free for TRIAL_DAYS and active at once. Otherwise it waits (pending) until the first payment.
 *  Does nothing if the business already has billing. `sb` is the service role client. */
export async function startBilling(sb, businessId, email, { trial = true, period = 'quarter' } = {}) {
  const per = ['week', 'month', 'quarter'].includes(period) ? period : 'quarter';
  const ends = trial ? trialEnd() : null;
  const { data, error } = await sb.from('subscriptions').upsert({
    business_id: businessId, plan: PLANS.standard.name, plan_code: 'standard', period: per,
    fee: listPrice('standard', per), setup_fee: 0, currency: 'KES', start_date: today(),
    paid_until: ends, trial_ends: ends, bill_email: String(email || '').toLowerCase(),
  }, { onConflict: 'business_id', ignoreDuplicates: true }).select('business_id');
  if (error) return false;
  // Pay now: hold the business until Paystack confirms the first payment (billing_apply switches it on).
  if (!trial && data?.length) await sb.from('businesses').update({ status: 'pending' }).eq('id', businessId).eq('status', 'active');
  return true;
}
