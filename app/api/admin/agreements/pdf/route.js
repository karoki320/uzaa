import { bad, adminClient, serverReady } from '@/lib/server';
import { boss } from '@/lib/admin';
import { pdfResponse } from '@/lib/agreement-pdf';

export const dynamic = 'force-dynamic';

// The super admin downloads an agreement: ?id=...&part=agreement|document|certificate
export async function GET(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  const sb = adminClient();
  if (!(await boss(sb))) return bad('Not allowed', 403);
  const u = new URL(req.url);
  const id = u.searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return bad('Bad request');
  const { data: a } = await sb.from('agreements').select('*').eq('id', id).maybeSingle();
  if (!a) return bad('Agreement not found', 404);
  return pdfResponse(a, u.searchParams.get('part'), u.searchParams.get('dl') === '1');
}
