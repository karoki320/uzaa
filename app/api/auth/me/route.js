import { NextResponse } from 'next/server';
import { userClient } from '@/lib/server';
export const dynamic = 'force-dynamic';

const claims = (t = '') => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); } catch { return {}; } };

// One call gives the app everything it needs to start: who you are, your 2FA state, your profile,
// business and branches. (Was four round trips; now one request and two database calls.)
export async function GET() {
  const h = { 'Cache-Control': 'no-store' };
  const sb = await userClient();
  const { data, error } = await sb.auth.getUser();   // verified with Supabase, not just decoded
  if (error || !data?.user) return NextResponse.json({ user: null }, { headers: h });
  const { data: s } = await sb.auth.getSession();
  const aal = claims(s?.session?.access_token).aal || 'aal1';
  const enrolled = (data.user.factors || []).some((f) => f.factor_type === 'totp' && f.status === 'verified');
  const needsMfa = enrolled && aal !== 'aal2';
  const out = { user: { id: data.user.id, email: data.user.email }, aal, needsMfa, mfaEnrolled: enrolled };
  if (needsMfa) return NextResponse.json({ ...out, mustEnrol: false, role: null }, { headers: h });

  const { data: profile } = await sb.from('profiles').select('*, businesses(*, branches(*))').eq('id', data.user.id)
    .order('created_at', { referencedTable: 'businesses.branches' }).maybeSingle();
  const { businesses, ...p } = profile || {};
  const { branches, ...business } = businesses || {};
  return NextResponse.json({
    ...out,
    mustEnrol: p?.role === 'super_admin' && !enrolled,
    role: p?.role || null,
    profile: profile ? p : null,
    business: businesses ? business : null,
    branches: branches || [],
  }, { headers: h });
}
