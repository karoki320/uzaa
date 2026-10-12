import { NextResponse } from 'next/server';
import { userClient, adminClient } from '@/lib/server';
import { claimsOf, stepState } from '@/lib/adminstep';
export const dynamic = 'force-dynamic';

// One call gives the app everything it needs to start: who you are, your second-step state, your profile,
// business and branches.
// The three reads are separate on purpose. A single nested select (profiles -> businesses -> branches)
// broke when businesses.agent_id was added, because there are now two links between profiles and
// businesses and the database refused to guess which one was meant. Owners were then sent to create a
// second business.
export async function GET() {
  const h = { 'Cache-Control': 'no-store' };
  const sb = await userClient();
  const { data, error } = await sb.auth.getUser();   // verified with Supabase, not just decoded
  if (error || !data?.user) return NextResponse.json({ user: null }, { headers: h });
  const uid = data.user.id;
  const { data: s } = await sb.auth.getSession();
  const c = claimsOf(s?.session?.access_token);
  const aal = c.aal || 'aal1';
  const enrolled = (data.user.factors || []).some((f) => f.factor_type === 'totp' && f.status === 'verified');
  const out = { user: { id: uid, email: data.user.email }, aal, mfaEnrolled: enrolled, mustEnrol: false };

  // Your own profile row is always readable to you (policy: id = auth.uid()).
  const { data: profile, error: pErr } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (pErr) return NextResponse.json({ ...out, needsMfa: false, profileError: pErr.message || 'Could not load your account' }, { headers: h });

  let needsMfa = false;
  let mfaMode = 'totp';
  let stepPending = false;
  if (profile?.role === 'super_admin') {
    mfaMode = 'email';
    if (aal !== 'aal2') {
      const st = await stepState(adminClient(), uid, c.session_id);
      needsMfa = !st.approved;
      stepPending = st.pending;
    }
  } else {
    needsMfa = enrolled && aal !== 'aal2';
  }
  if (needsMfa) return NextResponse.json({ ...out, needsMfa, mfaMode, stepPending, role: null }, { headers: h });
  if (!profile) return NextResponse.json({ ...out, needsMfa, mfaMode, role: null, profile: null, business: null, branches: [] }, { headers: h });

  let business = null;
  let branches = [];
  if (profile.business_id) {
    const [b, br] = await Promise.all([
      sb.from('businesses').select('*').eq('id', profile.business_id).maybeSingle(),
      sb.from('branches').select('*').eq('business_id', profile.business_id).order('created_at'),
    ]);
    if (b.error) return NextResponse.json({ ...out, needsMfa, profileError: b.error.message || 'Could not load your business' }, { headers: h });
    business = b.data || null;
    branches = br.data || [];
  }
  return NextResponse.json({ ...out, needsMfa, mfaMode, role: profile.role, profile, business, branches }, { headers: h });
}
