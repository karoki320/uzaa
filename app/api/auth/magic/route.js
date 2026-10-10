import { bad, ok, userClient, serverReady, sameOrigin, readJson, normEmail, emailOk, clientIp, adminClient, logEvent } from '@/lib/server';
import { hitIp, hitEmail, LIMITS, verifyCaptcha, captchaConfigured } from '@/lib/ratelimit';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  const email = normEmail(b.email);
  if (!emailOk(email)) return bad('Enter a valid email');
  const l1 = await hitIp('magic', req, LIMITS.magicIp); if (l1) return l1;
  const l2 = await hitEmail('magic', email, LIMITS.magicEmail); if (l2) return l2;
  if (captchaConfigured() && !(await verifyCaptcha(b.captcha, clientIp(req)))) return bad('Please complete the check below to continue.', 400, { captcha: true });
  const sb = await userClient();
  await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });   // never creates accounts
  await logEvent(adminClient(), 'magic', { email, ip: clientIp(req) });
  return ok({ message: 'If that email has an account, a sign-in link is on its way. It works once and expires in an hour.' });
}
