import { NextResponse } from 'next/server';
import { userClient } from '@/lib/server';
export const dynamic = 'force-dynamic';

export async function GET() {
  const h = { 'Cache-Control': 'no-store' };
  const sb = await userClient();
  const { data, error } = await sb.auth.getUser();   // verified with Supabase, not just decoded
  if (error || !data?.user) return NextResponse.json({ user: null }, { headers: h });
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  const { data: prof } = await sb.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  const { data: f } = await sb.auth.mfa.listFactors();
  const enrolled = (f?.totp || []).length > 0;
  return NextResponse.json({
    user: { id: data.user.id, email: data.user.email },
    aal: aal?.currentLevel || 'aal1',
    needsMfa: aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2',
    mfaEnrolled: enrolled,
    mustEnrol: prof?.role === 'super_admin' && !enrolled,
    role: prof?.role || null,
  }, { headers: h });
}
