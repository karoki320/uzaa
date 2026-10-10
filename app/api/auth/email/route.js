import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson, normEmail, emailOk, clientIp, logEvent } from '@/lib/server';
import { hit, LIMITS } from '@/lib/ratelimit';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  const email = normEmail(b.email);
  if (!emailOk(email)) return bad('Enter a valid email');
  const sb = await userClient();
  const { data } = await sb.auth.getUser();
  if (!data?.user) return bad('Sign in again', 401);
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') return bad('Enter your authenticator code first.', 403, { mfa: true });
  const l = await hit('chgemail', data.user.id, LIMITS.changeUser); if (l) return l;
  const { error } = await sb.auth.updateUser({ email });
  await logEvent(adminClient(), 'email_change', { email: data.user.email, ip: clientIp(req), success: !error });
  if (error) return bad('Could not change the email. It may already be in use.');
  return ok({ message: 'Check both inboxes. Open the link we sent to confirm the change.' });
}
