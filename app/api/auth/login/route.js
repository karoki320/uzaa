import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson, normEmail, emailOk, clientIp, logEvent } from '@/lib/server';
import { hitIp, lockState, noteFailure, clearFailures, loginKeys, verifyCaptcha, captchaConfigured, LIMITS, CAPTCHA_AFTER, IP_FREE, IP_LOCK_AT } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  const email = normEmail(b.email);
  const password = typeof b.password === 'string' ? b.password : '';
  if (!emailOk(email) || !password || password.length > 200) return bad('Enter your email and password');

  const limited = await hitIp('login', req, LIMITS.loginIp);
  if (limited) return limited;

  const ip = clientIp(req);
  const keys = loginKeys(req, email);
  const [a, i] = await Promise.all([lockState(keys.acct), lockState(keys.ip)]);
  const locked = Math.max(a.lockedFor, i.lockedFor);
  if (locked > 0) {
    const mins = Math.max(1, Math.ceil(locked / 60));
    return bad(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 429, { retry_after: locked });
  }
  if ((a.failures >= CAPTCHA_AFTER || i.failures >= IP_FREE) && captchaConfigured()) {
    if (!(await verifyCaptcha(b.captcha, ip))) return bad('Please complete the check below to continue.', 400, { captcha: true });
  }

  const sb = await userClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  const admin = adminClient();
  if (error || !data?.session) {
    const unconfirmed = error?.code === 'email_not_confirmed';
    if (!unconfirmed) {
      const [fa] = await Promise.all([noteFailure(keys.acct), noteFailure(keys.ip, IP_FREE, IP_LOCK_AT)]);
      await logEvent(admin, 'login', { email, ip, success: false, detail: error?.code || 'failed' });
      return bad('Wrong email or password.', 401, { captcha: captchaConfigured() && fa.failures >= CAPTCHA_AFTER });
    }
    await logEvent(admin, 'login', { email, ip, success: false, detail: 'unconfirmed' });
    return bad('Confirm your email first. We can send the link again.', 403, { unconfirmed: true });
  }
  await Promise.all([clearFailures(keys.acct), clearFailures(keys.ip)]);
  await logEvent(admin, 'login', { email, ip, success: true });

  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') return ok({ mfa: true, next: '/mfa' });
  const { data: prof } = await sb.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  if (prof?.role === 'super_admin') return ok({ next: '/security?setup=1' });   // no factor yet: must enrol before anything opens
  return ok({ next: '/home' });
}
