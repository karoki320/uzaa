import { ok, bad, userClient, sameOrigin } from '@/lib/server';
export const dynamic = 'force-dynamic';
export async function POST(req) {
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const sb = await userClient();
  await sb.auth.signOut();   // revokes the session on Supabase and clears the cookies
  return ok();
}
