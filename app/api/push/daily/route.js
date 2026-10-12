import { NextResponse } from 'next/server';
import { adminClient, serverReady } from '@/lib/server';
import { pushReady, sendTo } from '@/lib/push';
import { money } from '@/lib/util';

export const dynamic = 'force-dynamic';

// Called once a day at 20:00 Nairobi (17:00 UTC, see vercel.json). Vercel's Hobby plan only allows daily
// cron jobs: an hourly schedule makes Vercel refuse every deployment. Every business that chose the daily
// summary gets one. Nothing else can call it: the scheduler sends a secret.
export async function GET(req) {
  if (!serverReady() || !pushReady()) return NextResponse.json({ ok: false, reason: 'not set up' }, { status: 503 });
  const secret = process.env.CRON_SECRET || '';
  const given = req.headers.get('authorization') || '';
  if (!secret || given !== `Bearer ${secret}`) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });

  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', hour12: false }).format(now));
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const from = new Date(`${parts}T00:00:00+03:00`);
  const to = new Date(from.getTime() + 864e5);

  const sb = adminClient();
  const { data: list } = await sb.from('businesses').select('id,name,currency').eq('notify_mode', 'daily').eq('status', 'active');
  let done = 0;
  for (const biz of list || []) {
    const { data: rows } = await sb.rpc('day_summary', { p_business: biz.id, p_from: from.toISOString(), p_to: to.toISOString() });
    const s = rows?.[0];
    if (!s || Number(s.sales) === 0) continue;
    const { data: owners } = await sb.from('profiles').select('id').eq('business_id', biz.id).eq('role', 'owner').eq('active', true);
    if (!owners?.length) continue;
    await sendTo(owners.map((o) => o.id), {
      title: `Today: ${money(s.total, biz.currency)}`,
      body: `${s.sales} sale${Number(s.sales) === 1 ? '' : 's'}. Cash ${money(s.cash, biz.currency)}, other ${money(s.other, biz.currency)}.`,
      url: '/reports',
      tag: `daily-${biz.id}`,
    });
    done += 1;
  }
  return NextResponse.json({ ok: true, hour, businesses: done }, { headers: { 'Cache-Control': 'no-store' } });
}
