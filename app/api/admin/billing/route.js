import { boss } from '@/lib/admin';
import { bad, ok, adminClient, serverReady, sameOrigin, readJson, clientIp, logEvent, emailOk, normEmail } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Super admin: every business's billing, and setting it by hand (price, how often, paid-up date).
export async function GET() {
  if (!serverReady()) return bad('Server is not set up', 500);
  const sb = adminClient();
  if (!(await boss(sb))) return bad('Not allowed', 403);
  const [{ data: subs, error }, { data: pays }] = await Promise.all([
    sb.from('subscriptions').select('business_id,plan,fee,period,setup_fee,setup_paid,currency,start_date,paid_until,bill_email,auto_renew,card_label,card_auth,updated_at'),
    sb.from('billing_payments').select('business_id,reference,kind,amount,currency,status,channel,covers_to,paid_at,created_at,note')
      .order('created_at', { ascending: false }).limit(300),
  ]);
  if (error) return bad('Run supabase/security-patch-18.sql in Supabase first', 500);
  return ok({
    subs: (subs || []).map(({ card_auth, ...s }) => ({ ...s, auto_renew: s.auto_renew && !!card_auth })),
    payments: pays || [],
  });
}

const money = (v) => { const n = Number(String(v ?? '').replace(/[, ]/g, '')); return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : null; };
const date = (v) => (v === '' || v == null ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : undefined);

export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const sb = adminClient();
  const me = await boss(sb);
  if (!me) return bad('Not allowed', 403);
  const b = await readJson(req);
  if (!/^[0-9a-f-]{36}$/i.test(String(b.business_id || ''))) return bad('Bad request');
  const fee = money(b.fee), setup = money(b.setup_fee), paid = date(b.paid_until), start = date(b.start_date);
  if (fee === null || setup === null) return bad('Enter the amounts as numbers');
  if (paid === undefined || start === undefined) return bad('Enter dates as YYYY-MM-DD');
  if (!['month', 'quarter', 'year'].includes(b.period)) return bad('Choose how often they pay');
  const email = normEmail(b.bill_email);
  if (email && !emailOk(email)) return bad('That billing email does not look right');

  const row = {
    business_id: b.business_id, plan: String(b.plan || '').trim().slice(0, 60) || 'Uzaa POS Standard',
    fee, period: b.period, setup_fee: setup, setup_paid: b.setup_paid === true, currency: 'KES',
    start_date: start, paid_until: paid, bill_email: email, updated_at: new Date().toISOString(),
  };
  if (b.stop_auto === true) Object.assign(row, { auto_renew: false, card_auth: '', card_label: '', card_email: '' });
  const { error } = await sb.from('subscriptions').upsert(row, { onConflict: 'business_id' });
  if (error) return bad('Could not save billing');
  // A paid-up date in the future unlocks a business that was locked for not paying.
  if (paid && paid >= new Date().toISOString().slice(0, 10)) {
    await sb.from('businesses').update({ status: 'active' }).eq('id', b.business_id).eq('status', 'lapsed');
  }
  await logEvent(sb, 'admin_billing_set', { email: me.email, ip: clientIp(req), success: true, detail: `${b.business_id} ${fee}/${b.period} until ${paid || '-'}` });
  return ok({});
}
