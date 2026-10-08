import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

const MIN_PW = 8;
const bad = (msg, status = 400) => NextResponse.json({ error: msg }, { status });

async function owner(req, sb) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/);
  if (!m) return null;
  const { data } = await sb.auth.getUser(m[1]);
  if (!data?.user) return null;
  const { data: p } = await sb.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  if (!p || p.role !== 'owner' || !p.active) return null;
  const { data: biz } = await sb.from('businesses').select('status').eq('id', p.business_id).maybeSingle();
  return biz && biz.status === 'active' ? p : null;
}

async function body(req) {
  try { const b = await body(req); return b && typeof b === 'object' ? b : {}; } catch { return {}; }
}

export async function POST(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return bad('Server is not set up', 500);
  const sb = admin();
  const me = await owner(req, sb);
  if (!me) return bad('Not allowed', 403);
  const b = await body(req);
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return bad('Enter a valid email');
  if (!b.password || String(b.password).length < MIN_PW || String(b.password).length > 100) return bad(`Password must be at least ${MIN_PW} characters`);
  if (!['manager', 'cashier'].includes(b.role)) return bad('Role must be manager or cashier');
  const { data: br } = await sb.from('branches').select('id').eq('id', b.branch_id).eq('business_id', me.business_id).maybeSingle();
  if (!br) return bad('Choose a branch');

  const { data: created, error } = await sb.auth.admin.createUser({ email, password: b.password, email_confirm: true });
  if (error) return bad('Could not create that user. The email may already be in use.');
  const { error: pe } = await sb.from('profiles').insert({
    id: created.user.id, business_id: me.business_id, branch_id: b.branch_id,
    full_name: String(b.full_name || '').trim(), email, role: b.role,
  });
  if (pe) {
    await sb.auth.admin.deleteUser(created.user.id);
    return bad('Could not save that user');
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return bad('Server is not set up', 500);
  const sb = admin();
  const me = await owner(req, sb);
  if (!me) return bad('Not allowed', 403);
  const b = await body(req);
  const { data: target } = await sb.from('profiles').select('*').eq('id', b.id).eq('business_id', me.business_id).maybeSingle();
  if (!target || target.role === 'owner') return bad('Cannot change this user');
  const upd = {};
  if (typeof b.active === 'boolean') upd.active = b.active;
  if (b.role && ['manager', 'cashier'].includes(b.role)) upd.role = b.role;
  if (b.branch_id) {
    const { data: br } = await sb.from('branches').select('id').eq('id', b.branch_id).eq('business_id', me.business_id).maybeSingle();
    if (!br) return bad('Bad branch');
    upd.branch_id = b.branch_id;
  }
  if (Object.keys(upd).length) {
    const { error } = await sb.from('profiles').update(upd).eq('id', b.id);
    if (error) return bad('Could not update that user');
  }
  if (typeof b.active === 'boolean') {
    // also ban or unban the login itself, so a disabled person cannot keep using an old session
    await sb.auth.admin.updateUserById(b.id, { ban_duration: b.active ? 'none' : '876000h' });
  }
  if (b.password) {
    if (String(b.password).length < MIN_PW || String(b.password).length > 100) return bad(`Password must be at least ${MIN_PW} characters`);
    const { error } = await sb.auth.admin.updateUserById(b.id, { password: b.password });
    if (error) return bad('Could not change the password');
  }
  return NextResponse.json({ ok: true });
}
