import { bad, ok, userClient, serverReady, sameOrigin, readJson } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { signReceipt } from '@/lib/ereceipt';
export const dynamic = 'force-dynamic';

// Signed-in staff ask for the customer's e-receipt link for a sale they are allowed to see
// (row level security decides). The link opens a public receipt page that never expires.
export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  if (!/^[0-9a-f-]{36}$/i.test(String(b.sale_id || ''))) return bad('Bad sale');
  const sb = await userClient();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return bad('Sign in again', 401);
  const l = await hit('ereceipt', u.user.id, { limit: 300, window: 900 }); if (l) return l;
  const { data: sale } = await sb.from('sales').select('id, business_id').eq('id', b.sale_id).maybeSingle();
  if (!sale) return bad('Sale not found', 404);
  const { data: biz } = await sb.from('businesses').select('ereceipt_enabled').eq('id', sale.business_id).maybeSingle();
  if (!biz?.ereceipt_enabled) return bad('E-receipts are switched off. The owner can turn them on in Settings.', 403);
  const origin = process.env.PUBLIC_SITE_URL?.replace(/\/$/, '') || new URL(req.url).origin;
  return ok({ url: `${origin}/r/${signReceipt(sale.id)}` });
}
