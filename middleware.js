import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Runs before every app page: refreshes the cookie session, sends signed-out visitors to /login,
// and keeps /admin for a super admin who has passed two-step verification.
const COOKIE = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' };
const PROTECTED = ['/pos', '/products', '/stock', '/sales', '/reports', '/staff', '/branches', '/settings', '/security', '/admin', '/home'];

const b64 = (s) => { try { return JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; } };

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
  const { data } = await sb.auth.getUser();   // checks with Supabase and refreshes an expired token
  const to = (p) => { const u = req.nextUrl.clone(); u.pathname = p; u.search = ''; return NextResponse.redirect(u); };
  if (!data?.user) return to('/login');

  if (path === '/admin' || path.startsWith('/admin/')) {
    const { data: s } = await sb.auth.getSession();
    const claims = b64((s?.session?.access_token || '').split('.')[1] || '');
    if (claims?.aal !== 'aal2') return to('/mfa');
  }
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export const config = {
  matcher: ['/((?!api/|_next/|brand/|demo/|fonts/|auth/|landing\\.html|favicon|icon|apple-icon|.*\\..*).*)'],
};
