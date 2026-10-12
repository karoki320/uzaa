import { userClient, serverReady, clientIp, adminClient, logEvent } from '@/lib/server';
import { hitIp } from '@/lib/ratelimit';
import { hop, afterVerify } from '@/lib/authhop';
import { sessionInfo } from '@/lib/adminstep';

export const dynamic = 'force-dynamic';

// Supabase's own email templates send people to the site root with "?code=...". Uzaa's templates use
// /auth/confirm instead, but this keeps the default links working so nobody lands on the sales page.
export async function GET(req) {
  if (!serverReady()) return hop('/login?e=setup');
  const url = new URL(req.url);

  const err = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (err) return hop(`/login?e=${/expire/i.test(err) ? 'reset_expired' : 'link'}`);

  const code = url.searchParams.get('code') || '';
  if (!code || code.length > 300) return hop('/login?e=link');
  if (await hitIp('confirm', req, { limit: 20, window: 900 })) return hop('/login?e=link');

  const sb = await userClient();
  const prior = await sessionInfo(sb);   // the session this browser had before the link, if any
  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  await logEvent(adminClient(), 'confirm_code', { email: data?.user?.email, ip: clientIp(req), success: !error });
  // Without the matching verifier (a link opened in a different browser, or an invite) this cannot complete.
  if (error || !data?.user) return hop('/login?e=link_device');

  // An invite can never arrive here (an invited person has no verifier), so this is a sign-in link:
  // finish setting the business up if this is a fresh signup, then send them on.
  return afterVerify(sb, data.user, url, '', prior.uid === data.user.id ? prior.sid : null, data.session?.access_token);
}
