import { NextResponse } from 'next/server';
import { safeNext } from './server';
import { registerFromMeta } from './register';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A page, not a 302, so the strict session cookie is sent on the next request.
export function hop(to) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${esc(to)}"><title>Uzaa</title><body style="font-family:system-ui;background:#FCF9F0;color:#14181F;display:grid;place-items:center;min-height:100vh;margin:0"><p>Opening Uzaa... <a href="${esc(to)}">Continue</a></p>`;
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

// Where someone goes once their link has been accepted.
export async function afterVerify(sb, user, url, type) {
  if (type === 'recovery' || type === 'invite') return hop(`/reset-password?from=${type}`);
  if (type === 'email_change') return hop('/security?changed=1');
  if (type === 'signup' || type === 'email' || !type) await registerFromMeta(sb, user);
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') return hop('/mfa');
  return hop(safeNext(url.searchParams.get('next'), '/home'));
}
