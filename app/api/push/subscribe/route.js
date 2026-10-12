import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { pushReady, vapidPublicKey, sendTo } from '@/lib/push';

export const dynamic = 'force-dynamic';

async function me(sb) {
  const u = await userClient();
  const { data } = await u.auth.getUser();
  if (!data?.user) return null;
  const { data: p } = await sb.from('profiles').select('id,role,business_id,active,full_name').eq('id', data.user.id).maybeSingle();
  return p?.active ? p : null;
}

// The key the browser needs to sign up for alerts.
export async function GET() {
  return ok({ key: vapidPublicKey(), ready: pushReady() });
}

// This phone agrees to alerts.
export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!pushReady()) return bad('Alerts are not set up on the server yet', 503);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const sb = adminClient();
  const p = await me(sb);
  if (!p) return bad('Sign in again', 401);
  const l = await hit('pushsub', p.id, { limit: 30, window: 3600 }); if (l) return l;

  const b = await readJson(req);
  const endpoint = String(b.endpoint || '');
  const p256dh = String(b.p256dh || '');
  const auth = String(b.auth || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 600 || !p256dh || !auth) return bad('Bad subscription');

  const { error } = await sb.from('push_subscriptions')
    .upsert({ user_id: p.id, business_id: p.business_id, endpoint, p256dh, auth, label: String(b.label || '').slice(0, 60) },
            { onConflict: 'endpoint' });
  if (error) return bad('Could not save that');
  if (b.test) await sendTo([p.id], { title: 'Alerts are on', body: 'This is how a sale will reach you.', url: '/sales' });
  return ok({ saved: true });
}

// This phone no longer wants them.
export async function DELETE(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const sb = adminClient();
  const p = await me(sb);
  if (!p) return bad('Sign in again', 401);
  const b = await readJson(req);
  if (!b.endpoint) return bad('Bad request');
  await sb.from('push_subscriptions').delete().eq('user_id', p.id).eq('endpoint', String(b.endpoint));
  return ok({ removed: true });
}
