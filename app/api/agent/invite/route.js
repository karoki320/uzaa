import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson, normEmail, emailOk, clientIp, logEvent } from '@/lib/server';
import { hit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

// The super admin adds someone to the sales team. They get an email and choose their own password.
async function boss(sb) {
  const me = await userClient();
  const { data } = await me.auth.getUser();
  if (!data?.user) return null;
  const { data: aal } = await me.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== 'aal2') return null;            // the super admin always needs 2FA
  const { data: p } = await sb.from('profiles').select('id,role,active').eq('id', data.user.id).maybeSingle();
  return p && p.role === 'super_admin' && p.active ? p : null;
}

export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const sb = adminClient();
  const me = await boss(sb);
  if (!me) return bad('Not allowed', 403);
  const l = await hit('agentinvite', me.id, { limit: 20, window: 3600 }); if (l) return l;

  const b = await readJson(req);
  const email = normEmail(b.email);
  const full = String(b.full_name || '').trim();
  if (!emailOk(email)) return bad('Enter a valid email');
  if (!full || full.length > 120) return bad('Enter their name');

  const { data: inv, error: ie } = await sb.auth.admin.inviteUserByEmail(email);
  if (ie || !inv?.user) return bad('Could not send that invite. The email may already be in use.');
  const { error } = await sb.from('profiles').insert({ id: inv.user.id, full_name: full.slice(0, 120), email, role: 'sales' });
  if (error) {
    await sb.auth.admin.deleteUser(inv.user.id);
    return bad('Could not add them to the sales team');
  }
  await logEvent(sb, 'agent_invite', { email, ip: clientIp(req), success: true });
  return ok({ invited: true });
}

// Turn an agent's access on or off.
export async function PATCH(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const sb = adminClient();
  const me = await boss(sb);
  if (!me) return bad('Not allowed', 403);
  const b = await readJson(req);
  if (!/^[0-9a-f-]{36}$/i.test(String(b.id || ''))) return bad('Bad request');
  const { data: p } = await sb.from('profiles').select('role').eq('id', b.id).maybeSingle();
  if (!p || p.role !== 'sales') return bad('Not a sales agent');
  const { error } = await sb.from('profiles').update({ active: !!b.active }).eq('id', b.id);
  if (error) return bad('Could not save that');
  return ok({ active: !!b.active });
}
