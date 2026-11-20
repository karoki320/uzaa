import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson } from '@/lib/server';
import { pushReady, sendTo } from '@/lib/push';
import { money } from '@/lib/util';

export const dynamic = 'force-dynamic';

// After someone reverses a sale, the owner's phone hears about it: which receipt, how much, who and why.
// Nothing is trusted from the caller: the record is read back from sale_deletions.
export async function POST(req) {
  if (!serverReady() || !pushReady()) return ok({ sent: 0 });
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  if (!/^[0-9a-f-]{36}$/i.test(String(b.id || ''))) return bad('Bad request');

  const u = await userClient();
  const { data: who } = await u.auth.getUser();
  if (!who?.user) return bad('Sign in again', 401);

  const sb = adminClient();
  const { data: caller } = await sb.from('profiles').select('id,role,business_id,full_name,active').eq('id', who.user.id).maybeSingle();
  if (!caller?.active || !caller.business_id) return bad('Not allowed', 403);
  const { data: d } = await sb.from('sale_deletions').select('*').eq('id', b.id).maybeSingle();
  if (!d || d.business_id !== caller.business_id || d.deleted_by !== caller.id) return bad('Not allowed', 403);

  const { data: biz } = await sb.from('businesses').select('currency,status').eq('id', d.business_id).maybeSingle();
  if (!biz || biz.status !== 'active') return ok({ sent: 0 });
  const { data: owners } = await sb.from('profiles').select('id').eq('business_id', d.business_id).eq('role', 'owner').eq('active', true).neq('id', caller.id);
  if (!owners?.length) return ok({ sent: 0 });

  const r = await sendTo(owners.map((o) => o.id), {
    title: `Sale #${d.receipt_no} reversed (${money(d.total, biz.currency)})`,
    body: `${caller.full_name || 'Staff'}: ${d.reason}`,
    url: '/reports',
    tag: `deleted-${d.id}`,
  });
  return ok(r);
}
