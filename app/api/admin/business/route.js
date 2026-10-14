import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson, clientIp, logEvent } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Only the Uzaa super admin, and only with two-step verification passed.
async function boss(sb) {
  const me = await userClient();
  const { data } = await me.auth.getUser();
  if (!data?.user) return null;
  const { data: aal } = await me.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== 'aal2') return null;
  const { data: p } = await sb.from('profiles').select('id,role,active').eq('id', data.user.id).maybeSingle();
  return p && p.role === 'super_admin' && p.active ? p : null;
}

// What disappears with this business. Shown before anything is touched.
export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const sb = adminClient();
  if (!(await boss(sb))) return bad('Not allowed', 403);
  const b = await readJson(req);
  if (!/^[0-9a-f-]{36}$/i.test(String(b.id || ''))) return bad('Bad request');

  const { data: biz } = await sb.from('businesses').select('id,name').eq('id', b.id).maybeSingle();
  if (!biz) return bad('That business is already gone', 404);
  const n = async (t) => (await sb.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz.id)).count || 0;
  return ok({
    name: biz.name,
    branches: await n('branches'), staff: await n('profiles'), products: await n('products'),
    sales: await n('sales'), customers: await n('customers'),
  });
}

// Remove the business and everything under it, including the logins that belong to it. There is no undo.
export async function DELETE(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const sb = adminClient();
  const me = await boss(sb);
  if (!me) return bad('Not allowed', 403);
  const b = await readJson(req);
  if (!/^[0-9a-f-]{36}$/i.test(String(b.id || ''))) return bad('Bad request');

  const { data: biz } = await sb.from('businesses').select('id,name').eq('id', b.id).maybeSingle();
  if (!biz) return bad('That business is already gone', 404);
  if (String(b.confirm || '').trim() !== biz.name) return bad('Type the business name exactly to confirm');

  const { data: staff } = await sb.from('profiles').select('id,role').eq('business_id', biz.id);
  const ids = (staff || []).filter((s) => s.role !== 'super_admin' && s.id !== me.id).map((s) => s.id);

  // The row goes first: every table under it is set to cascade, so nothing is left pointing at a
  // business that no longer exists.
  const { error } = await sb.from('businesses').delete().eq('id', biz.id);
  if (error) return bad('Could not remove that business');

  // Then the logins, so nobody is left with a sign-in that leads nowhere.
  let removed = 0;
  for (const id of ids) {
    const { error: ue } = await sb.auth.admin.deleteUser(id);
    if (!ue) removed += 1;
  }
  await logEvent(sb, 'admin_delete_business', { email: biz.name, ip: clientIp(req), success: true });
  return ok({ deleted: biz.name, logins: removed });
}
