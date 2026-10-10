import { NextResponse } from 'next/server';
import { createHmac, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isProd = process.env.NODE_ENV === 'production';

// One cookie policy for the whole app: not readable by scripts, HTTPS only, never sent cross-site.
export const COOKIE_OPTS = { httpOnly: true, secure: isProd, sameSite: 'strict', path: '/', maxAge: 60 * 60 * 24 * 30 };
export const hardenCookie = (o = {}) => ({ ...o, ...COOKIE_OPTS, maxAge: o.maxAge === 0 ? 0 : o.maxAge ?? COOKIE_OPTS.maxAge });

export const bad = (error, status = 400, extra = {}) => NextResponse.json({ error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
export const ok = (data = {}) => NextResponse.json({ ok: true, ...data }, { headers: { 'Cache-Control': 'no-store' } });

/** Supabase client bound to the visitor's cookie session (route handlers and server components). */
export async function userClient() {
  const jar = await cookies();
  return createServerClient(SUPA_URL, ANON, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => jar.set(name, value, hardenCookie(options))); } catch {} },
    },
  });
}

/** Service role client. Server only, never sent to the browser. */
export const adminClient = () => createClient(SUPA_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
export const serverReady = () => Boolean(SUPA_URL && ANON && process.env.SUPABASE_SERVICE_ROLE_KEY);

export function clientIp(req) {
  const h = req.headers;
  return (h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',')[0] || 'unknown').trim().slice(0, 64);
}

/** Blocks cross-site form posts. Combined with SameSite=Strict cookies. */
export function sameOrigin(req) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin) { try { return new URL(origin).host === host; } catch { return false; } }
  return req.headers.get('sec-fetch-site') === 'same-origin';
}

export async function readJson(req, max = 20000) {
  try {
    const t = await req.text();
    if (t.length > max) return {};
    const b = JSON.parse(t || '{}');
    return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  } catch { return {}; }
}

export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const emailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 200;

// Keys never contain a raw email: only a keyed hash.
const salt = () => process.env.RATE_LIMIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'uzaa';
export const hk = (v) => createHmac('sha256', salt()).update(String(v)).digest('hex').slice(0, 32);
export const sha = (v) => createHash('sha256').update(String(v)).digest('hex');

/** Allow only same-site relative paths for redirects. */
export function safeNext(n, fallback = '/home') {
  const s = String(n || '');
  return s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') && !/[\r\n]/.test(s) ? s : fallback;
}

export async function logEvent(sb, event, { email, ip, success, detail } = {}) {
  try { await sb.from('auth_events').insert({ event, email: email ? hk(email) : null, ip: ip || null, success: success ?? null, detail: detail ? String(detail).slice(0, 200) : null }); } catch {}
}
