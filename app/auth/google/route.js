import { userClient, serverReady, clientIp, adminClient, logEvent, safeNext } from '@/lib/server';
import { hitIp } from '@/lib/ratelimit';
import { hop } from '@/lib/authhop';
import { roleOf } from '@/lib/adminstep';

export const dynamic = 'force-dynamic';

// Back from Google. Existing users go to their shop; someone new goes to the short signup form
// (name already known from Google, just the business name left).
export async function GET(req) {
  if (!serverReady()) return hop('/login?e=setup');
  const url = new URL(req.url);
  if (url.searchParams.get('error')) return hop('/login?e=google');
  const code = url.searchParams.get('code') || '';
  if (!code || code.length > 300) return hop('/login?e=google');
  if (await hitIp('confirm', req, { limit: 20, window: 900 })) return hop('/login?e=busy');

  const sb = await userClient();
  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  await logEvent(adminClient(), 'google', { email: data?.user?.email, ip: clientIp(req), success: !error });
  if (error || !data?.user) return hop('/login?e=google');

  const admin = adminClient();
  // The super admin keeps the email step: Google sign-in is not allowed for that account.
  if ((await roleOf(admin, data.user.id)) === 'super_admin') {
    await sb.auth.signOut();
    return hop('/login?e=google_admin');
  }
  const { data: mine } = await sb.from('profiles').select('id').eq('id', data.user.id).maybeSingle();
  if (!mine) return hop('/signup?g=1');
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') return hop('/mfa');
  const next = safeNext(url.searchParams.get('next'), '/home');
  return hop(next === '/signup' ? '/home' : next);
}
