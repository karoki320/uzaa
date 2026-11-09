import { bad, ok, adminClient, serverReady, sameOrigin, readJson, clientIp, logEvent } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { tokenOk } from '@/lib/agreement';
import { jpegSize } from '@/lib/pdf';

export const dynamic = 'force-dynamic';

// The client signs: their drawn signature, their typed name and a tick that they agree.
// The time, internet address and device are recorded with it. The business stays waiting until the
// Uzaa admin activates it.
export async function POST(req, { params }) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const { token } = await params;
  if (!tokenOk(token)) return bad('This link is not valid', 404);
  const ip = clientIp(req);
  const l = await hit('agreementsign', `ip:${ip}`, { limit: 20, window: 900 }); if (l) return l;

  const b = await readJson(req, 300000);
  const name = String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const title = String(b.title || '').trim().slice(0, 80);
  const sig = String(b.signature || '');
  if (b.agree !== true) return bad('Tick the box to confirm you have read and agree to the agreement');
  if (name.length < 3) return bad('Type your full name');
  if (!sig.startsWith('data:image/jpeg;base64,') || sig.length > 200000) return bad('Draw your signature in the box');
  const size = jpegSize(Buffer.from(sig.split(',')[1], 'base64'));
  if (!size || size.w < 50 || size.h < 20) return bad('Draw your signature in the box');
  if (b.drawn !== true) return bad('Draw your signature in the box');

  const sb = adminClient();
  const { data: a } = await sb.from('agreements').select('id,status,business_id,client_email,viewed_at').eq('token', token).maybeSingle();
  if (!a || a.status === 'void') return bad('This agreement link is no longer valid', 404);
  if (a.status === 'signed') return bad('This agreement has already been signed', 409);

  const now = new Date().toISOString();
  const { data: done, error } = await sb.from('agreements').update({
    status: 'signed', signed_at: now, viewed_at: a.viewed_at || now,
    signer_name: name, signer_title: title, signature: sig,
    signer_ip: ip, signer_agent: String(req.headers.get('user-agent') || '').slice(0, 300),
  }).eq('id', a.id).in('status', ['sent', 'viewed']).select('id').maybeSingle();
  if (error || !done) return bad('Could not save your signature. Please try again.');
  await logEvent(sb, 'agreement_signed', { email: a.client_email, ip, success: true });
  return ok({ signed_at: now });
}
