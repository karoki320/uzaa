import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson, normEmail, emailOk, clientIp, logEvent } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { TYPE_PRESETS } from '@/lib/util';

export const dynamic = 'force-dynamic';

// A sales agent sets a business up and the owner is invited by email.
// The agent's own session decides whether they are allowed; the database checks it again.
async function agent(sb) {
  const me = await userClient();
  const { data } = await me.auth.getUser();
  if (!data?.user) return null;
  const { data: aal } = await me.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') return null;
  const { data: p } = await sb.from('profiles').select('id,role,active,full_name').eq('id', data.user.id).maybeSingle();
  return p && p.role === 'sales' && p.active ? p : null;
}

export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const sb = adminClient();
  const me = await agent(sb);
  if (!me) return bad('Not allowed', 403);
  const l = await hit('agentbiz', me.id, { limit: 40, window: 3600 }); if (l) return l;

  const b = await readJson(req);
  const name = String(b.name || '').trim();
  const ownerName = String(b.owner_name || '').trim();
  const branch = String(b.branch || '').trim() || 'Main Branch';
  const phone = String(b.owner_phone || '').trim().slice(0, 20);
  const type = TYPE_PRESETS[b.type] ? b.type : 'retail';
  const email = normEmail(b.owner_email);
  if (!name || name.length > 120) return bad('Enter the business name');
  if (!ownerName || ownerName.length > 120) return bad('Enter the name of the proprietor');
  if (phone.replace(/\D/g, '').length < 9) return bad("Enter the proprietor's phone number");
  if (!emailOk(email)) return bad("Enter the owner's email address");

  // the owner gets an email, opens the link and chooses their own password
  const { data: inv, error: ie } = await sb.auth.admin.inviteUserByEmail(email);
  if (ie || !inv?.user) return bad('Could not send that invite. The email may already be in use.');

  const preset = TYPE_PRESETS[type];
  const usr = await userClient();
  const { data: bid, error } = await usr.rpc('create_business_as_agent', {
    p_owner: inv.user.id, p_name: name, p_type: type, p_owner_name: ownerName, p_owner_email: email,
    p_branch: branch, p_item_label: preset.item_label, p_custom_fields: preset.custom_fields, p_owner_phone: phone,
  });
  if (error || !bid) {
    await sb.auth.admin.deleteUser(inv.user.id);     // nothing half-made is left behind
    return bad(error?.message || 'Could not set that business up');
  }
  await logEvent(sb, 'agent_business', { email, ip: clientIp(req), success: true });
  return ok({ id: bid });
}
