import { bad, ok, userClient, serverReady, sameOrigin, readJson } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { signPrint } from '@/lib/print';
export const dynamic = 'force-dynamic';

// Signed-in staff ask for a print link for a sale they are allowed to see (row level security decides).
export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  if (!/^[0-9a-f-]{36}$/i.test(String(b.sale_id || ''))) return bad('Bad sale');
  const sb = await userClient();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return bad('Sign in again', 401);
  const l = await hit('printlink', u.user.id, { limit: 120, window: 900 }); if (l) return l;
  const { data: sale } = await sb.from('sales').select('id').eq('id', b.sale_id).maybeSingle();
  if (!sale) return bad('Sale not found', 404);
  const token = signPrint(sale.id, Number(b.width) === 48 ? 48 : 32);
  const origin = new URL(req.url).origin;
  return ok({ url: `${origin}/api/print/${token}` });
}
