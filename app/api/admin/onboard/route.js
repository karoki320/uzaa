import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson, normEmail, emailOk, clientIp, logEvent } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { TYPE_PRESETS } from '@/lib/util';
import { boss } from '@/lib/admin';
import { readAgreementInput, createAgreement, clientFrom, siteUrl } from '@/lib/agreement-store';

export const dynamic = 'force-dynamic';

// The super admin onboards a client in one go: the business (waiting for activation), the owner's
// login (they get an email to choose a password) and, if wanted, the service agreement to sign.
export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const sb = adminClient();
  const me = await boss(sb);
  if (!me) return bad('Not allowed', 403);
  const l = await hit('adminonboard', me.id, { limit: 60, window: 3600 }); if (l) return l;

  const b = await readJson(req, 4_600_000);
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
  const input = readAgreementInput(b.agreement);
  if (input.error) return bad(input.error);

  const { data: inv, error: ie } = await sb.auth.admin.inviteUserByEmail(email);
  if (ie || !inv?.user) return bad('Could not send the invite. That email may already have an Uzaa account.');

  const preset = TYPE_PRESETS[type];
  const usr = await userClient();
  const { data: bid, error } = await usr.rpc('create_business_as_admin', {
    p_owner: inv.user.id, p_name: name, p_type: type, p_owner_name: ownerName, p_owner_email: email,
    p_branch: branch, p_item_label: preset.item_label, p_custom_fields: preset.custom_fields, p_owner_phone: phone,
  });
  if (error || !bid) {
    await sb.auth.admin.deleteUser(inv.user.id);     // nothing half-made is left behind
    const missing = /create_business_as_admin/.test(error?.message || '');
    return bad(missing ? 'Run supabase/security-patch-12.sql in Supabase first' : error?.message || 'Could not set that business up');
  }
  await logEvent(sb, 'admin_onboard', { email, ip: clientIp(req), success: true });

  let agreement = null; let warning = '';
  if (input.mode !== 'none') {
    const r = await createAgreement(sb, { businessId: bid, client: clientFrom({ ...b, owner_email: email }), input, terms: b.agreement?.terms, by: me.id });
    if (r.error) warning = `The business is set up, but the agreement was not: ${r.error}. Send it from the business list.`;
    else agreement = { ...r.agreement, url: `${siteUrl(req)}/agreement/${r.agreement.token}` };
  }
  return ok({ id: bid, agreement, warning });
}
