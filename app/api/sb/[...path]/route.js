import { NextResponse } from 'next/server';
import { SUPA_URL, ANON, userClient, sameOrigin } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Same-origin gateway to the data API. The browser never holds a token: the httpOnly cookie is
// read here, and the access token is attached on the way to Supabase.
const PASS_REQ = ['accept', 'accept-profile', 'content-profile', 'content-type', 'prefer', 'range', 'range-unit'];
const PASS_RES = ['content-type', 'content-range', 'content-profile', 'preference-applied', 'content-location'];
const MAX_BODY = 1_000_000;

async function handle(req, ctx) {
  const { path } = await ctx.params;
  const rel = (path || []).join('/');
  if (!/^rest\/v1\/[A-Za-z0-9_\-/]*$/.test(rel) || rel.includes('..')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const write = !['GET', 'HEAD'].includes(req.method);
  if (write && !sameOrigin(req)) return NextResponse.json({ error: 'Blocked' }, { status: 403 });

  const profile = req.headers.get('accept-profile') || req.headers.get('content-profile');
  if (profile && profile !== 'public') return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const sb = await userClient();
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return NextResponse.json({ message: 'Not signed in' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  const headers = new Headers();
  PASS_REQ.forEach((h) => { const v = req.headers.get(h); if (v) headers.set(h, v); });
  headers.set('apikey', ANON);
  headers.set('authorization', `Bearer ${token}`);

  let body;
  if (write) {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_BODY) return NextResponse.json({ error: 'Too large' }, { status: 413 });
    body = buf;
  }
  const url = `${SUPA_URL}/${rel}${new URL(req.url).search}`;
  const r = await fetch(url, { method: req.method, headers, body, cache: 'no-store' });
  const out = new Headers({ 'Cache-Control': 'no-store' });
  PASS_RES.forEach((h) => { const v = r.headers.get(h); if (v) out.set(h, v); });
  return new NextResponse(r.status === 204 || req.method === 'HEAD' ? null : r.body, { status: r.status, headers: out });
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE, handle as HEAD };
