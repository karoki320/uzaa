import { createClient } from '@supabase/supabase-js';
import { userClient, adminClient, serverReady, sameOrigin, readJson, normEmail, emailOk, bad, ok, SUPA_URL, ANON, clientIp, logEvent } from '@/lib/server';
import { hit, LIMITS } from '@/lib/ratelimit';
import { checkPassword } from '@/lib/pwned';

export const dynamic = 'force-dynamic';

// Only an active owner of an active business, signed in with the cookie session (and 2FA if they use it).
async function owner(req, sb) {
  const me = await userClient();
  const { data } = await me.auth.getUser();
  if (!data?.user) return null;
  const { data: aal } = await me.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') return null;
  const { data: p } = await sb.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  if (!p || p.role !== 'owner' || !p.active) return null;
  const { data: biz } = await sb.from('businesses').select('status').eq('id', p.business_id).maybeSingle();
  return biz && biz.status === 'active' ? p : null;
}

async function gate(req) {
  if (!serverReady()) return { res: bad('Server is not set up', 500) };
  if (!sameOrigin(req)) return { res: bad('Blocked', 403) };
  const sb = adminClient();
  const me = await owner(req, sb);
  if (!me) return { res: bad('Not allowed', 403) };
  const l = await hit('staff', me.id, LIMITS.staffUser);
  if (l) return { res: l };
  return { sb, me };
}

export async function POST(req) {
  const g = await gate(req);
  if (g.res) return g.res;
  const { sb, me } = g;
  const b = await readJson(req);
  const email = normEmail(b.email);
  if (!emailOk(email)) return bad('Enter a valid email');
  if (!['manager', 'cashier'].includes(b.role)) return bad('Role must be manager or cashier');
  const { data: br } = await sb.from('branches').select('id').eq('id', b.branch_id).eq('business_id', me.business_id).maybeSingle();
  if (!br) return bad('Choose a branch');

  let created;
  if (b.mode === 'invite') {
    // They get an email, open the link and choose their own password.
    const { data, error } = await sb.auth.admin.inviteUserByEmail(email);
    if (error || !data?.user) return bad('Could not send that invite. The email may already be in use.');
    created = data.user;
  } else {
    const pwErr = await checkPassword(b.password, email);
    if (pwErr) return bad(pwErr);
    const { data, error } = await sb.auth.admin.createUser({ email, password: b.password, email_confirm: true });
    if (error || !data?.user) return bad('Could not create that user. The email may already be in use.');
    created = data.user;
  }
  const { error: pe } = await sb.from('profiles').insert({
    id: created.id, business_id: me.business_id, branch_id: b.branch_id,
    full_name: String(b.full_name || '').trim().slice(0, 120), email, role: b.role,
  });
  if (pe) {
    await sb.auth.admin.deleteUser(created.id);
    return bad('Could not save that user');
  }
  await logEvent(sb, b.mode === 'invite' ? 'staff_invite' : 'staff_create', { email, ip: clientIp(req), success: true });
  return ok({ invited: b.mode === 'invite' });
}

export async function PATCH(req) {
  const g = await gate(req);
  if (g.res) return g.res;
  const { sb, me } = g;
  const b = await readJson(req);
  const { data: target } = await sb.from('profiles').select('*').eq('id', b.id).eq('business_id', me.business_id).maybeSingle();
  if (!target || target.role === 'owner') return bad('Cannot change this user');

  if (b.send_link) {
    // Emails the person a link to choose a new password (also works as a fresh invite).
    const anon = createClient(SUPA_URL, ANON, { auth: { persistSession: false } });
    await anon.auth.resetPasswordForEmail(target.email);
    return ok({ sent: true });
  }

  const upd = {};
  if (typeof b.active === 'boolean') upd.active = b.active;
  if (b.role && ['manager', 'cashier'].includes(b.role)) upd.role = b.role;
  if (b.branch_id) {
    const { data: br } = await sb.from('branches').select('id').eq('id', b.branch_id).eq('business_id', me.business_id).maybeSingle();
    if (!br) return bad('Bad branch');
    upd.branch_id = b.branch_id;
  }
  if (b.password) {
    const pwErr = await checkPassword(b.password, target.email);
    if (pwErr) return bad(pwErr);
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
    const { error } = await sb.auth.admin.updateUserById(b.id, { password: b.password });
    if (error) return bad('Could not change the password');
  }
  return ok();
}
