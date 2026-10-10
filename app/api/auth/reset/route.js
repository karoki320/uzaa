import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson, clientIp, logEvent } from '@/lib/server';
import { hit, LIMITS } from '@/lib/ratelimit';
import { checkPassword } from '@/lib/pwned';
export const dynamic = 'force-dynamic';

// Sets a new password for the person who just opened a reset or invite link (they hold a session from /auth/confirm).
export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  const sb = await userClient();
  const { data } = await sb.auth.getUser();
  if (!data?.user) return bad('This link has expired. Request a new one.', 401, { expired: true });
  const l = await hit('changepw', data.user.id, LIMITS.changeUser); if (l) return l;
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') return bad('Enter your authenticator code first.', 403, { mfa: true });
  const err = await checkPassword(b.password, data.user.email);
  if (err) return bad(err);
  const { error } = await sb.auth.updateUser({ password: b.password });
  if (error) return bad(error.code === 'same_password' ? 'Choose a password you have not used before.' : 'Could not change the password. Request a new link.');
  await sb.auth.signOut({ scope: 'others' });   // any other device that knew the old password is signed out
  await logEvent(adminClient(), 'password_reset', { email: data.user.email, ip: clientIp(req), success: true });
  return ok({ next: '/home' });
}
