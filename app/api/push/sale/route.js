import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson } from '@/lib/server';
import { pushReady, sendTo } from '@/lib/push';
import { money } from '@/lib/util';

export const dynamic = 'force-dynamic';

// The till calls this straight after a sale. Only the owners of that business are told, and only if they
// asked to hear about every sale. Nothing here trusts the caller: the sale is read back from the database.
export async function POST(req) {
  if (!serverReady() || !pushReady()) return ok({ sent: 0 });
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  if (!/^[0-9a-f-]{36}$/i.test(String(b.sale_id || ''))) return bad('Bad sale');

  const u = await userClient();
  const { data: who } = await u.auth.getUser();
  if (!who?.user) return bad('Sign in again', 401);

  const sb = adminClient();
  const { data: caller } = await sb.from('profiles').select('id,role,business_id,full_name,active').eq('id', who.user.id).maybeSingle();
  if (!caller?.active || !caller.business_id) return bad('Not allowed', 403);
  if (caller.role === 'owner') return ok({ sent: 0 });            // the owner rang it up themselves

  const { data: sale } = await sb.from('sales')
    .select('id,total,payment_method,receipt_no,branch_id,cashier_id,business_id')
    .eq('id', b.sale_id).maybeSingle();
  if (!sale || sale.business_id !== caller.business_id || sale.cashier_id !== caller.id) return bad('Not allowed', 403);

  const { data: biz } = await sb.from('businesses').select('notify_mode,notify_min,currency,status').eq('id', sale.business_id).maybeSingle();
  if (!biz || biz.status !== 'active' || biz.notify_mode !== 'sale') return ok({ sent: 0 });
  if (Number(sale.total) < Number(biz.notify_min || 0)) return ok({ sent: 0 });

  const { data: owners } = await sb.from('profiles').select('id').eq('business_id', sale.business_id).eq('role', 'owner').eq('active', true);
  if (!owners?.length) return ok({ sent: 0 });

  const { data: br } = await sb.from('branches').select('name').eq('id', sale.branch_id).maybeSingle();
  const r = await sendTo(owners.map((o) => o.id), {
    title: `Sale ${money(sale.total, biz.currency)}`,
    body: `${caller.full_name || 'A cashier'} at ${br?.name || 'your shop'}, paid by ${sale.payment_method}. Receipt #${sale.receipt_no}.`,
    url: '/sales',
    tag: `sale-${sale.id}`,
  });
  return ok(r);
}
