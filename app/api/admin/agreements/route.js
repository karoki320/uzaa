import { bad, ok, adminClient, serverReady, sameOrigin, readJson } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { boss } from '@/lib/admin';
import { newToken } from '@/lib/agreement';
import { LIST_COLS, readAgreementInput, createAgreement, clientFrom, siteUrl } from '@/lib/agreement-store';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;

// Every agreement, newest first, for the super admin's dashboard.
export async function GET(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  const sb = adminClient();
  if (!(await boss(sb))) return bad('Not allowed', 403);
  const { data, error } = await sb.from('agreements').select(LIST_COLS).order('created_at', { ascending: false }).limit(500);
  if (error) return bad(/agreements/.test(error.message) ? 'Run supabase/security-patch-12.sql in Supabase to turn on agreements' : 'Could not load agreements', 500);
  const base = siteUrl(req);
  return ok({ rows: (data || []).map((a) => ({ ...a, url: `${base}/agreement/${a.token}` })) });
}

// Send an agreement to a business that is already on Uzaa (generated or uploaded).
export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const sb = adminClient();
  const me = await boss(sb);
  if (!me) return bad('Not allowed', 403);
  const l = await hit('adminagreement', me.id, { limit: 80, window: 3600 }); if (l) return l;
  const b = await readJson(req, 4_600_000);
  if (!UUID.test(String(b.business_id || ''))) return bad('Choose a business');
  const { data: biz } = await sb.from('businesses').select('id,name,owner_email,owner_phone').eq('id', b.business_id).maybeSingle();
  if (!biz) return bad('That business no longer exists', 404);
  const input = readAgreementInput({ ...b.agreement, mode: b.agreement?.mode === 'upload' ? 'upload' : 'generate' });
  if (input.error) return bad(input.error);
  const client = clientFrom({ ...b, name: b.client_business || biz.name, owner_email: b.client_email || biz.owner_email, owner_phone: b.client_phone || biz.owner_phone });
  if (!client.client_name) return bad("Enter the client's name");
  const r = await createAgreement(sb, { businessId: biz.id, client, input, terms: b.agreement?.terms, by: me.id });
  if (r.error) return bad(r.error);
  return ok({ agreement: { ...r.agreement, url: `${siteUrl(req)}/agreement/${r.agreement.token}` } });
}

// Cancel an agreement, or give it a fresh link (the old link stops working).
export async function PATCH(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const sb = adminClient();
  if (!(await boss(sb))) return bad('Not allowed', 403);
  const b = await readJson(req);
  if (!UUID.test(String(b.id || ''))) return bad('Bad request');
  const { data: a } = await sb.from('agreements').select('id,status').eq('id', b.id).maybeSingle();
  if (!a) return bad('Agreement not found', 404);
  if (a.status === 'signed') return bad('A signed agreement cannot be changed. Send a new one instead.');
  const patch = b.action === 'void' ? { status: 'void' } : b.action === 'relink' ? { token: newToken(), status: a.status === 'void' ? 'sent' : a.status, sent_at: new Date().toISOString() } : null;
  if (!patch) return bad('Bad request');
  const { data, error } = await sb.from('agreements').update(patch).eq('id', a.id).select(LIST_COLS).single();
  if (error) return bad('Could not save that');
  return ok({ agreement: { ...data, url: `${siteUrl(req)}/agreement/${data.token}` } });
}
