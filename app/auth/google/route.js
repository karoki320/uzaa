import { cookies } from 'next/headers';
import { userClient, serverReady, clientIp, adminClient, logEvent, safeNext } from '@/lib/server';
import { hitIp } from '@/lib/ratelimit';
import { hop } from '@/lib/authhop';
import { roleOf } from '@/lib/adminstep';
import { G_COOKIE, readGoogleCookie, googleToken } from '@/lib/google';

export const dynamic = 'force-dynamic';

// Back from Google. Existing users go to their shop; someone new goes to the short signup form
// (name already known from Google, just the business name left).
export async function GET(req) {
  if (!serverReady()) return hop('/login?e=setup');
  const url = new URL(req.url);
  const jar = await cookies();
  const g = readGoogleCookie(jar);
  const done = (to) => { const res = hop(to); res.cookies.set(G_COOKIE, '', { path: '/', maxAge: 0 }); return res; };

  if (url.searchParams.get('error')) return done('/login?e=google');
  const code = url.searchParams.get('code') || '';
  if (!code || code.length > 600) return done('/login?e=google');
  if (await hitIp('confirm', req, { limit: 20, window: 900 })) return done('/login?e=busy');

  const sb = await userClient();
  let user = null;
  let next = safeNext(url.searchParams.get('next'), '/home');
  const state = url.searchParams.get('state');
  if (state && g) {
    // straight from Google: check it is the sign-in this browser started, then hand Google's token to Supabase
    if (state !== g.state) return done('/login?e=google');
    next = safeNext(g.next, '/home');
    const idToken = await googleToken(url.origin, code);
    if (!idToken) return done('/login?e=google');
    const { data, error } = await sb.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce: g.nonce });
    if (!error) user = data?.user || null;
  } else {
    // Supabase's own Google flow
    const { data, error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) user = data?.user || null;
  }
  await logEvent(adminClient(), 'google', { email: user?.email, ip: clientIp(req), success: !!user });
  if (!user) return done('/login?e=google');

  const admin = adminClient();
  // The super admin keeps the email step: Google sign-in is not allowed for that account.
  if ((await roleOf(admin, user.id)) === 'super_admin') {
    await sb.auth.signOut();
    return done('/login?e=google_admin');
  }
  const { data: mine } = await sb.from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (!mine) return done('/signup?g=1');
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') return done('/mfa');
  return done(next === '/signup' ? '/home' : next);
}
