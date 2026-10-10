import { bad, ok, userClient, serverReady, sameOrigin, readJson, normEmail, emailOk, clientIp, adminClient, logEvent } from '@/lib/server';
import { hitIp, LIMITS, verifyCaptcha, captchaConfigured } from '@/lib/ratelimit';
import { checkPassword } from '@/lib/pwned';
import { registerFromMeta } from '@/lib/register';
import { TYPE_PRESETS } from '@/lib/util';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  const business = String(b.business || '').trim();
  const full_name = String(b.full_name || '').trim();
  const type = TYPE_PRESETS[b.type] ? b.type : 'retail';
  if (!business || business.length > 120) return bad('Enter your business name');
  if (!full_name || full_name.length > 120) return bad('Enter your name');

  const l = await hitIp('signup', req, LIMITS.signupIp); if (l) return l;
  const sb = await userClient();

  // Already confirmed and signed in, but no business yet: just create the business.
  const { data: cur } = await sb.auth.getUser();
  if (cur?.user && !b.email) {
    const done = await registerFromMeta(sb, { ...cur.user, user_metadata: { business, full_name, type } });
    return done ? ok({ next: '/pos' }) : bad('Could not set up your business');
  }

  const email = normEmail(b.email);
  if (!emailOk(email)) return bad('Enter a valid email');
  const pwErr = await checkPassword(b.password, email);
  if (pwErr) return bad(pwErr);
  if (captchaConfigured() && !(await verifyCaptcha(b.captcha, clientIp(req)))) return bad('Please complete the check below to continue.', 400, { captcha: true });

  const { data, error } = await sb.auth.signUp({ email, password: b.password, options: { data: { business, full_name, type } } });
  await logEvent(adminClient(), 'signup', { email, ip: clientIp(req), success: !error });
  if (error) return bad('Could not create that account. If you already have one, sign in instead.');
  if (data.session) {   // email confirmation is switched off in Supabase: finish setting up now
    const done = await registerFromMeta(sb, data.user);
    return done ? ok({ next: '/pos' }) : bad('Account created, but the business could not be set up. Sign in to retry.');
  }
  return ok({ confirm: true, message: `We sent a confirmation link to ${email}. Open it to finish setting up your business.` });
}
