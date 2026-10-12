import webpush from 'web-push';
import { adminClient } from './server';

const PUB = process.env.VAPID_PUBLIC_KEY || '';
const PRIV = process.env.VAPID_PRIVATE_KEY || '';
export const pushReady = () => !!(PUB && PRIV);
if (pushReady()) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hello@biziirise.com', PUB, PRIV);

/** Sends one alert to every phone the given people have signed up, and forgets the ones that have gone. */
export async function sendTo(userIds, payload) {
  if (!pushReady() || !userIds.length) return { sent: 0 };
  const sb = adminClient();
  const { data: subs } = await sb.from('push_subscriptions').select('*').in('user_id', userIds);
  if (!subs?.length) return { sent: 0 };
  const body = JSON.stringify(payload);
  const dead = [];
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600 });
      sent += 1;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.id);   // the phone dropped it
    }
  }));
  if (dead.length) await sb.from('push_subscriptions').delete().in('id', dead);
  if (sent) await sb.from('push_subscriptions').update({ last_sent: new Date().toISOString() }).in('user_id', userIds);
  return { sent };
}

export const vapidPublicKey = () => PUB;
