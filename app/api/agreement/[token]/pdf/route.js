import { bad, adminClient, serverReady, clientIp } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { tokenOk } from '@/lib/agreement';
import { pdfResponse } from '@/lib/agreement-pdf';

export const dynamic = 'force-dynamic';

// The client opens or downloads their agreement from the private link (no account needed).
export async function GET(req, { params }) {
  if (!serverReady()) return bad('Server is not set up', 500);
  const { token } = await params;
  if (!tokenOk(token)) return bad('Not found', 404);
  const l = await hit('agreementpdf', `ip:${clientIp(req)}`, { limit: 60, window: 900 }); if (l) return l;
  const sb = adminClient();
  const { data: a } = await sb.from('agreements').select('*').eq('token', token).maybeSingle();
  if (!a || a.status === 'void') return bad('This agreement link is no longer valid', 404);
  const u = new URL(req.url);
  return pdfResponse(a, u.searchParams.get('part'), u.searchParams.get('dl') === '1');
}
