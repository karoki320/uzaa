import { userClient, serverReady, clientIp, adminClient, logEvent } from '@/lib/server';
import { hitIp } from '@/lib/ratelimit';
import { hop, afterVerify } from '@/lib/authhop';
import { sessionInfo } from '@/lib/adminstep';

export const dynamic = 'force-dynamic';
const TYPES = ['signup', 'recovery', 'magiclink', 'invite', 'email_change', 'email'];
// Uzaa's own email links land here: the one-time token is checked on the server, the session becomes a
// secure cookie, and the person is sent on.
export async function GET(req) {
  if (!serverReady()) return hop('/login?e=setup');
  const url = new URL(req.url);
  const token_hash = url.searchParams.get('token_hash') || '';
  const type = url.searchParams.get('type') || '';
  if (!token_hash || token_hash.length > 300 || !TYPES.includes(type)) return hop('/login?e=link');
  if (await hitIp('confirm', req, { limit: 20, window: 900 })) return hop('/login?e=link');

  const sb = await userClient();
  const prior = await sessionInfo(sb);   // the session this browser had before the link, if any
  const { data, error } = await sb.auth.verifyOtp({ token_hash, type });
  await logEvent(adminClient(), `confirm_${type}`, { email: data?.user?.email, ip: clientIp(req), success: !error });
  if (error || !data?.user) return hop(`/login?e=${type === 'recovery' ? 'reset_expired' : 'link'}`);

  return afterVerify(sb, data.user, url, type, prior.uid === data.user.id ? prior.sid : null, data.session?.access_token);
}
