import { bad, ok, adminClient, serverReady, sameOrigin, readJson, clientIp } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { tokenOk } from '@/lib/agreement';
import { startCheckout, standing } from '@/lib/billing';

export const dynamic = 'force-dynamic';

// The first payment (set-up fee and first period), straight from the signed agreement page.
// No account needed: the private agreement link is the key. Paying switches the business on.
export async function POST(req, { params }) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const { token } = await params;
  if (!tokenOk(token)) return bad('This link is not valid', 404);
  const l = await hit('agreementpay', `ip:${clientIp(req)}`, { limit: 10, window: 900 }); if (l) return l;
  const b = await readJson(req);

  const sb = adminClient();
  const { data: a } = await sb.from('agreements').select('id,status,business_id,client_email').eq('token', token).maybeSingle();
  if (!a || a.status === 'void') return bad('This agreement link is no longer valid', 404);
  if (a.status !== 'signed') return bad('Sign the agreement first');
  if (!a.business_id) return bad('Your account is not linked yet. Please contact Uzaa.');
  const [{ data: sub }, { data: biz }] = await Promise.all([
    sb.from('subscriptions').select('*').eq('business_id', a.business_id).maybeSingle(),
    sb.from('businesses').select('status').eq('id', a.business_id).maybeSingle(),
  ]);
  if (!sub || !(Number(sub.fee) > 0)) return bad('Uzaa has not set the price for your plan yet. Please contact them.');
  if (biz?.status === 'suspended') return bad('This account is suspended. Please contact Uzaa support.');
  const st = standing(sub, biz?.status);
  if (st.state === 'ok' || st.state === 'due') return bad('You have already paid. Sign in to Uzaa to start selling.', 409);
  try {
    const url = await startCheckout(sb, req, { sub, kind: sub.setup_paid || sub.paid_until ? 'renewal' : 'first', email: sub.bill_email || a.client_email, saveCard: b.save_card === true });
    return ok({ url });
  } catch (e) { return bad(e.message || 'Could not start the payment'); }
}
