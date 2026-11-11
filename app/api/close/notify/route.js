import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson } from '@/lib/server';
import { pushReady, sendTo } from '@/lib/push';
import { money } from '@/lib/util';

export const dynamic = 'force-dynamic';

// After a cashier or manager closes the day, the owner's phone hears the result: counted, expected and the
// difference. Nothing is trusted from the caller: the count is read back from the database.
export async function POST(req) {
  if (!serverReady() || !pushReady()) return ok({ sent: 0 });
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  if (!/^[0-9a-f-]{36}$/i.test(String(b.id || ''))) return bad('Bad count');

  const u = await userClient();
  const { data: who } = await u.auth.getUser();
  if (!who?.user) return bad('Sign in again', 401);

  const sb = adminClient();
  const { data: caller } = await sb.from('profiles').select('id,role,business_id,full_name,active').eq('id', who.user.id).maybeSingle();
  if (!caller?.active || !caller.business_id) return bad('Not allowed', 403);

  const { data: c } = await sb.from('cash_counts').select('*').eq('id', b.id).maybeSingle();
  if (!c || c.business_id !== caller.business_id || c.user_id !== caller.id) return bad('Not allowed', 403);

  const { data: biz } = await sb.from('businesses').select('currency,status').eq('id', c.business_id).maybeSingle();
  if (!biz || biz.status !== 'active') return ok({ sent: 0 });
  const { data: owners } = await sb.from('profiles').select('id').eq('business_id', c.business_id).eq('role', 'owner').eq('active', true).neq('id', caller.id);
  if (!owners?.length) return ok({ sent: 0 });

  const { data: br } = await sb.from('branches').select('name').eq('id', c.branch_id).maybeSingle();
  const d = Number(c.diff);
  const cur = biz.currency;
  const r = await sendTo(owners.map((o) => o.id), {
    title: d === 0 ? `Till balanced: ${money(c.counted, cur)}` : d < 0 ? `Till short by ${money(-d, cur)}` : `Till over by ${money(d, cur)}`,
    body: `${caller.full_name || 'Staff'} closed ${br?.name || 'the shop'}: counted ${money(c.counted, cur)}, expected ${money(c.expected, cur)}.${c.note ? ` Note: ${c.note}` : ''}`,
    url: '/sales',
    tag: `close-${c.branch_id}-${c.day}`,
  });
  return ok(r);
}
