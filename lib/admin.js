import { userClient } from './server';
import { secondStepMissing } from './adminstep';

/** The signed-in Uzaa super admin (second step passed), or null. `sb` is the service role client. */
export async function boss(sb) {
  const me = await userClient();
  const { data } = await me.auth.getUser();
  if (!data?.user) return null;
  if (await secondStepMissing(me, sb, data.user.id)) return null;
  const { data: p } = await sb.from('profiles').select('id,role,active,full_name,email').eq('id', data.user.id).maybeSingle();
  return p && p.role === 'super_admin' && p.active ? p : null;
}
