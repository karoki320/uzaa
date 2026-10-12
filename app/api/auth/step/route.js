import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson, clientIp, logEvent } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { sessionInfo, resendStep } from '@/lib/adminstep';
export const dynamic = 'force-dynamic';

// The super admin's waiting screen: send the sign-in link again.
export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  if (b.action !== 'resend') return bad('Unknown action');
  const sb = await userClient();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return bad('Sign in again', 401);
  const l = await hit('adminstep', u.user.id, { limit: 4, window: 900 }); if (l) return l;
  const admin = adminClient();
  const { sid } = await sessionInfo(sb);
  const r = await resendStep(sb, admin, u.user, sid);
  await logEvent(admin, 'admin_step_resend', { email: u.user.email, ip: clientIp(req), success: r === 'sent' });
  if (r === 'approved') return ok({ approved: true });
  if (r === 'nosession') return bad('Sign in with your password first.', 401, { signIn: true });
  if (r === 'failed') return bad('Could not send the email just now. Wait a minute and try again.', 503);
  return ok({ message: `We sent a new link to ${u.user.email}.` });
}
