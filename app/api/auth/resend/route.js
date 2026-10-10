import { bad, ok, userClient, serverReady, sameOrigin, readJson, normEmail, emailOk, clientIp, adminClient, logEvent } from '@/lib/server';
import { hitIp, hitEmail, LIMITS } from '@/lib/ratelimit';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  const email = normEmail(b.email);
  if (!emailOk(email)) return bad('Enter a valid email');
  const l1 = await hitIp('resend', req, LIMITS.resendIp); if (l1) return l1;
  const l2 = await hitEmail('resend', email, LIMITS.resendEmail); if (l2) return l2;
  const sb = await userClient();
  await sb.auth.resend({ type: 'signup', email });
  await logEvent(adminClient(), 'resend', { email, ip: clientIp(req) });
  return ok({ message: 'If that email is waiting to be confirmed, we sent the link again.' });
}
