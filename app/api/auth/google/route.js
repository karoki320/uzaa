import { NextResponse } from 'next/server';
import { userClient, serverReady, safeNext } from '@/lib/server';
import { hitIp } from '@/lib/ratelimit';
import { hop } from '@/lib/authhop';
import { googleDirect, googleStart } from '@/lib/google';

export const dynamic = 'force-dynamic';

// "Continue with Google": sends the browser to Google, which comes back to /auth/google.
export async function GET(req) {
  if (!serverReady()) return hop('/login?e=setup');
  if (await hitIp('google', req, { limit: 30, window: 900 })) return hop('/login?e=busy');
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get('next'), '/home');

  // Straight to Google: its screen shows Uzaa and uzaa.co.ke
  if (googleDirect()) {
    const { url: to, cookie } = googleStart(url.origin, next);
    const res = NextResponse.redirect(to, { headers: { 'Cache-Control': 'no-store' } });
    res.cookies.set(...cookie);
    return res;
  }

  // Fallback: Supabase's Google flow (Google's screen shows the Supabase address)
  const sb = await userClient();
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${url.origin}/auth/google?next=${encodeURIComponent(next)}`,
      skipBrowserRedirect: true,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error || !data?.url) return hop('/login?e=google');
  return NextResponse.redirect(data.url, { headers: { 'Cache-Control': 'no-store' } });
}
