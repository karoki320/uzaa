import { bad, ok, userClient, serverReady, sameOrigin, readJson, normEmail, emailOk, clientIp, adminClient, logEvent } from '@/lib/server';
import { hitIp, hitEmail, LIMITS, verifyCaptcha, captchaConfigured } from '@/lib/ratelimit';
export const dynamic = 'force-dynamic';

// Same answer whether or not the email exists, so this cannot be used to find out who has an account.
export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  const email = normEmail(b.email);
  if (!emailOk(email)) return bad('Enter a valid email');
  const l1 = await hitIp('forgot', req, LIMITS.forgotIp); if (l1) return l1;
  const l2 = await hitEmail('forgot', email, LIMITS.forgotEmail); if (l2) return l2;
  if (captchaConfigured() && !(await verifyCaptcha(b.captcha, clientIp(req)))) return bad('Please complete the check below to continue.', 400, { captcha: true });
  const sb = await userClient();
  await sb.auth.resetPasswordForEmail(email);
  await logEvent(adminClient(), 'forgot', { email, ip: clientIp(req) });
  return ok({ message: 'If that email has an account, a reset link is on its way. It works once and expires in an hour.' });
}
