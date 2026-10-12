import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Runs before every app page: refreshes the cookie session, sends signed-out visitors to /login,
// The admin second step is enforced in the database and by /api/auth/me.
// 30 days, so people stay signed in on their own phone. Without maxAge these become session cookies
// and everyone is asked to sign in again as soon as they close the app.
const COOKIE = {
  httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/',
  maxAge: 60 * 60 * 24 * 30,
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
};
const PROTECTED = ['/pos', '/products', '/stock', '/sales', '/reports', '/staff', '/branches', '/settings', '/security', '/admin', '/agent', '/home'];

export async function middleware(req) {
  const path = req.nextUrl.pathname;
  const guarded = PROTECTED.some((p) => path === p || path.startsWith(p + '/'));
  let res = NextResponse.next({ request: req });
  if (!guarded) return res;

  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, { ...options, ...COOKIE }));
      },
    },
  });
  // Reads the cookie session locally (and refreshes it if expired): no extra trip to Supabase per page.
  // This only decides which screen to show. Data is protected by row level security and the API routes,
  // which check every request with Supabase.
  const { data } = await sb.auth.getSession();
  const to = (p) => { const u = req.nextUrl.clone(); u.pathname = p; u.search = ''; return NextResponse.redirect(u); };
  if (!data?.session) return to('/login');

  // /admin's second step (emailed link, or authenticator app) is checked by /api/auth/me, which sends the
  // screen to /mfa, and by the database itself: without it no admin data opens (auth_ok).
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export const config = {
  matcher: ['/((?!api/|_next/|brand/|demo/|fonts/|auth/|landing\\.html|favicon|icon|apple-icon|.*\\..*).*)'],
};
