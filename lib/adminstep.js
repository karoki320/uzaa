import { clientIp } from './server';

// Super admin second step by email instead of an authenticator app.
// 1. The password is accepted: this browser's session is recorded as "waiting" and Uzaa emails a sign-in link.
// 2. The link is opened, on this device or any other: the waiting session is approved for APPROVE_HOURS.
// The database (auth_ok) checks the approval by the session id inside the sign-in token, so a session
// that never entered the password, or was never approved, sees no admin data at all.
export const APPROVE_HOURS = 12;
const LINK_MINUTES = 60;   // Supabase sign-in links expire after one hour

export const claimsOf = (t = '') => {
  try { return JSON.parse(Buffer.from(String(t).split('.')[1] || '', 'base64url').toString()) || {}; } catch { return {}; }
};

export async function sessionInfo(sb) {
  const { data } = await sb.auth.getSession();
  const c = claimsOf(data?.session?.access_token);
  return { sid: c.session_id || null, aal: c.aal || 'aal1', uid: c.sub || null };
}

export async function roleOf(admin, uid) {
  if (!uid) return null;
  const { data } = await admin.from('profiles').select('role').eq('id', uid).maybeSingle();
  return data?.role || null;
}

/** { approved, pending } for this session. */
export async function stepState(admin, uid, sid) {
  if (!uid || !sid) return { approved: false, pending: false };
  const { data } = await admin.from('admin_steps').select('approved_at, sent_at').eq('session_id', sid).eq('user_id', uid).maybeSingle();
  if (!data) return { approved: false, pending: false };
  const approved = Boolean(data.approved_at) && Date.now() - new Date(data.approved_at).getTime() < APPROVE_HOURS * 3600e3;
  const pending = !data.approved_at && Date.now() - new Date(data.sent_at).getTime() < LINK_MINUTES * 60e3;
  return { approved, pending };
}

async function sendLink(sb, email) {
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  return !error;
}

/** After the password: mark this session as waiting and email the link. */
export async function startStep(sb, admin, user, sid, req) {
  if (!sid) return false;
  await admin.from('admin_steps').delete().eq('user_id', user.id).lt('sent_at', new Date(Date.now() - 2 * 86400e3).toISOString());
  const { error } = await admin.from('admin_steps').upsert({
    session_id: sid, user_id: user.id, sent_at: new Date().toISOString(), approved_at: null,
    ip: clientIp(req), user_agent: (req.headers.get('user-agent') || '').slice(0, 200),
  }, { onConflict: 'session_id' });
  if (error) return false;
  return sendLink(sb, user.email);
}

/** "Send it again" from the waiting screen. Only a session that entered the password can ask. */
export async function resendStep(sb, admin, user, sid) {
  if (!(await rowExists(admin, user.id, sid))) return 'nosession';
  if ((await stepState(admin, user.id, sid)).approved) return 'approved';
  await admin.from('admin_steps').update({ sent_at: new Date().toISOString(), approved_at: null }).eq('session_id', sid).eq('user_id', user.id);
  return (await sendLink(sb, user.email)) ? 'sent' : 'failed';
}
async function rowExists(admin, uid, sid) {
  if (!sid) return false;
  const { data } = await admin.from('admin_steps').select('session_id').eq('session_id', sid).eq('user_id', uid).maybeSingle();
  return Boolean(data);
}

/**
 * The emailed link was opened. Only the newest email's link works (Supabase replaces the token on every
 * send), so we approve the newest waiting session. If the link was opened in the same browser that
 * entered the password, the new session on this browser is approved too.
 * Returns 'here' (this browser can go on), 'elsewhere' (another device was approved) or 'none'.
 */
export async function approveFromLink(admin, uid, priorSid, newSid) {
  const since = new Date(Date.now() - LINK_MINUTES * 60e3).toISOString();
  const { data: rows } = await admin.from('admin_steps').select('session_id, sent_at')
    .eq('user_id', uid).is('approved_at', null).gte('sent_at', since).order('sent_at', { ascending: false }).limit(1);
  const latest = rows?.[0];
  if (!latest) return 'none';
  const now = new Date().toISOString();
  await admin.from('admin_steps').update({ approved_at: now }).eq('session_id', latest.session_id);
  if (priorSid && priorSid === latest.session_id && newSid) {
    await admin.from('admin_steps').upsert({ session_id: newSid, user_id: uid, sent_at: now, approved_at: now }, { onConflict: 'session_id' });
    return 'here';
  }
  return 'elsewhere';
}

/** True when this request still needs its second step (email link for the super admin, app code for others). */
export async function secondStepMissing(sb, admin, uid) {
  const { sid, aal } = await sessionInfo(sb);
  if ((await roleOf(admin, uid)) === 'super_admin') {
    if (aal === 'aal2') return false;
    return !(await stepState(admin, uid, sid)).approved;
  }
  const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.nextLevel === 'aal2' && data?.currentLevel !== 'aal2';
}
