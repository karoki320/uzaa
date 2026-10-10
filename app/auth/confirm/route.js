import { NextResponse } from 'next/server';
import { userClient, safeNext, serverReady, clientIp, adminClient, logEvent } from '@/lib/server';
import { hitIp } from '@/lib/ratelimit';
import { registerFromMeta } from '@/lib/register';

export const dynamic = 'force-dynamic';
const TYPES = ['signup', 'recovery', 'magiclink', 'invite', 'email_change', 'email'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Every email link lands here. The one-time token is verified server side, the session is set as a secure cookie,
// and the person is sent on. The hop is a page (not a 302) so the strict cookie is sent on the next request.
function hop(to) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${esc(to)}"><title>Uzaa</title><body style="font-family:system-ui;background:#FCF9F0;color:#14181F;display:grid;place-items:center;min-height:100vh;margin:0"><p>Opening Uzaa... <a href="${esc(to)}">Continue</a></p>`;
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

export async function GET(req) {
  if (!serverReady()) return hop('/login?e=setup');
  const url = new URL(req.url);
  const token_hash = url.searchParams.get('token_hash') || '';
  const type = url.searchParams.get('type') || '';
  if (!token_hash || token_hash.length > 300 || !TYPES.includes(type)) return hop('/login?e=link');
  if (await hitIp('confirm', req, { limit: 20, window: 900 })) return hop('/login?e=link');

  const sb = await userClient();
  const { data, error } = await sb.auth.verifyOtp({ token_hash, type });
  await logEvent(adminClient(), `confirm_${type}`, { email: data?.user?.email, ip: clientIp(req), success: !error });
  if (error || !data?.user) return hop(`/login?e=${type === 'recovery' ? 'reset_expired' : 'link'}`);

  if (type === 'recovery' || type === 'invite') return hop(`/reset-password?from=${type}`);
  if (type === 'email_change') return hop('/security?changed=1');
  if (type === 'signup' || type === 'email') await registerFromMeta(sb, data.user);

  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') return hop('/mfa');
  return hop(safeNext(url.searchParams.get('next'), '/home'));
}
