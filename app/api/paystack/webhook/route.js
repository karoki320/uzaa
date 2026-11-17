import { NextResponse } from 'next/server';
import { adminClient, serverReady } from '@/lib/server';
import { signatureOk } from '@/lib/paystack';
import { settle } from '@/lib/billing';

export const dynamic = 'force-dynamic';

// Paystack tells us about payments here, even if the client closed the page before coming back.
// Set this address in Paystack: Settings > API Keys & Webhooks > Webhook URL = https://uzaa.co.ke/api/paystack/webhook
// Only signed messages are read, and even then the payment is checked again with Paystack before it counts.
export async function POST(req) {
  const raw = await req.text();
  if (raw.length > 200000 || !signatureOk(raw, req.headers.get('x-paystack-signature'))) {
    return NextResponse.json({ error: 'Bad signature' }, { status: 401 });
  }
  if (!serverReady()) return NextResponse.json({ ok: false }, { status: 503 });
  let ev;
  try { ev = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  const ref = String(ev?.data?.reference || '');
  if (ev?.event === 'charge.success' && ref.startsWith('UZA-')) {
    const r = await settle(adminClient(), ref);
    // 5xx makes Paystack try again later, which is what we want if Paystack itself was slow to answer.
    if (r.status === 'pending') return NextResponse.json({ ok: false }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
