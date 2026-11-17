import { bad, ok, adminClient, serverReady, clientIp } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { settle } from '@/lib/billing';

export const dynamic = 'force-dynamic';

// The page Paystack returns to asks how the payment went. The answer always comes from Paystack itself.
export async function GET(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  const ref = new URL(req.url).searchParams.get('reference') || '';
  if (!/^UZA-[A-Z0-9-]{8,60}$/.test(ref)) return bad('Bad reference');
  const l = await hit('billingverify', `ip:${clientIp(req)}`, { limit: 40, window: 900 }); if (l) return l;
  const r = await settle(adminClient(), ref);
  return ok({ status: r.status, paid_until: r.paid_until || null, message: r.message || '' });
}
