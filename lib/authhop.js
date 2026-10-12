import { NextResponse } from 'next/server';
import { safeNext } from './server';
import { registerFromMeta } from './register';
import { adminClient, COOKIE_OPTS } from './server';
import { roleOf, approveFromLink, claimsOf, makeTrust, TRUST_COOKIE, TRUST_DAYS } from './adminstep';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A page, not a 302, so the strict session cookie is sent on the next request.
export function hop(to) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${esc(to)}"><title>Uzaa</title><body style="font-family:system-ui;background:#FCF9F0;color:#14181F;display:grid;place-items:center;min-height:100vh;margin:0"><p>Opening Uzaa... <a href="${esc(to)}">Continue</a></p>`;
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

// Where someone goes once their link has been accepted.
// priorSid: the session this browser had before the link was opened (used for the super admin's email step).
export async function afterVerify(sb, user, url, type, priorSid = null, newToken = '') {
  if (type === 'recovery' || type === 'invite') return hop(`/reset-password?from=${type}`);
  if (type === 'email_change') return hop('/security?changed=1');
  if (type === 'signup' || type === 'email' || !type) await registerFromMeta(sb, user);

  const admin = adminClient();
  if ((type === 'magiclink' || type === 'email' || !type) && (await roleOf(admin, user.id)) === 'super_admin') {
    let token = newToken;
    if (!token) { const { data: s } = await sb.auth.getSession(); token = s?.session?.access_token || ''; }
    const where = await approveFromLink(admin, user.id, priorSid, claimsOf(token).session_id);
    if (where !== 'here') return hop('/mfa');
    const res = hop('/admin');
    res.cookies.set(TRUST_COOKIE, makeTrust(user.id), { ...COOKIE_OPTS, maxAge: TRUST_DAYS * 86400 });
    return res;
  }
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') return hop('/mfa');
  return hop(safeNext(url.searchParams.get('next'), '/home'));
}
