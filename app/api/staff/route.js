import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

async function owner(req, sb) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return null;
  const { data } = await sb.auth.getUser(token);
  if (!data?.user) return null;
  const { data: p } = await sb.from('profiles').select('*').eq('id', data.user.id).single();
  return p && p.role === 'owner' && p.active ? p : null;
}

export async function POST(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  const sb = admin();
  const me = await owner(req, sb);
  if (!me) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const b = await req.json();
  const email = String(b.email || '').trim().toLowerCase();
  if (!email || !b.password || String(b.password).length < 6) return NextResponse.json({ error: 'Email and a password of at least 6 characters are required' }, { status: 400 });
  if (!['manager', 'cashier'].includes(b.role)) return NextResponse.json({ error: 'Role must be manager or cashier' }, { status: 400 });
  const { data: br } = await sb.from('branches').select('id').eq('id', b.branch_id).eq('business_id', me.business_id).maybeSingle();
  if (!br) return NextResponse.json({ error: 'Choose a branch' }, { status: 400 });

  const { data: created, error } = await sb.auth.admin.createUser({ email, password: b.password, email_confirm: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { error: pe } = await sb.from('profiles').insert({
    id: created.user.id, business_id: me.business_id, branch_id: b.branch_id,
    full_name: String(b.full_name || '').trim(), email, role: b.role,
  });
  if (pe) {
    await sb.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: pe.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  const sb = admin();
  const me = await owner(req, sb);
  if (!me) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const b = await req.json();
  const { data: target } = await sb.from('profiles').select('*').eq('id', b.id).eq('business_id', me.business_id).maybeSingle();
  if (!target || target.role === 'owner') return NextResponse.json({ error: 'Cannot change this user' }, { status: 400 });
  const upd = {};
  if (typeof b.active === 'boolean') upd.active = b.active;
  if (b.role && ['manager', 'cashier'].includes(b.role)) upd.role = b.role;
  if (b.branch_id) {
    const { data: br } = await sb.from('branches').select('id').eq('id', b.branch_id).eq('business_id', me.business_id).maybeSingle();
    if (!br) return NextResponse.json({ error: 'Bad branch' }, { status: 400 });
    upd.branch_id = b.branch_id;
  }
  if (Object.keys(upd).length) {
    const { error } = await sb.from('profiles').update(upd).eq('id', b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (b.password) {
    if (String(b.password).length < 6) return NextResponse.json({ error: 'Password too short' }, { status: 400 });
    const { error } = await sb.auth.admin.updateUserById(b.id, { password: b.password });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
