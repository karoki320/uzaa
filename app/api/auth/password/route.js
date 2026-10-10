import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson, clientIp, logEvent } from '@/lib/server';
import { hit, LIMITS } from '@/lib/ratelimit';
import { checkPassword } from '@/lib/pwned';
export const dynamic = 'force-dynamic';

// Change password while signed in. Needs a one-time code emailed to the account (Supabase "secure password change").
export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  const sb = await userClient();
  const { data } = await sb.auth.getUser();
  if (!data?.user) return bad('Sign in again', 401);
  const uid = data.user.id;
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') return bad('Enter your authenticator code first.', 403, { mfa: true });

  if (b.action === 'send') {
    const l = await hit('reauth', uid, LIMITS.reauthUser); if (l) return l;
    const { error } = await sb.auth.reauthenticate();
    if (error) return bad('Could not send the code. Try again shortly.');
    return ok({ message: `We emailed a 6 digit code to ${data.user.email}.` });
  }
  const l = await hit('changepw', uid, LIMITS.changeUser); if (l) return l;
  const nonce = String(b.code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(nonce)) return bad('Enter the 6 digit code from your email');
  const err = await checkPassword(b.password, data.user.email);
  if (err) return bad(err);
  const { error } = await sb.auth.updateUser({ password: b.password, nonce });
  if (error) return bad(error.code === 'same_password' ? 'Choose a password you have not used before.' : 'That code is wrong or has expired.');
  await sb.auth.signOut({ scope: 'others' });
  await logEvent(adminClient(), 'password_change', { email: data.user.email, ip: clientIp(req), success: true });
  return ok({ message: 'Password changed. Other devices were signed out.' });
}
