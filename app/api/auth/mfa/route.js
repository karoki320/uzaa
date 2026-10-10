import { randomInt } from 'node:crypto';
import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson, sha, clientIp, logEvent } from '@/lib/server';
import { hit, LIMITS } from '@/lib/ratelimit';
export const dynamic = 'force-dynamic';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => { let s = ''; for (let i = 0; i < 10; i++) s += ALPHA[randomInt(ALPHA.length)]; return `${s.slice(0, 5)}-${s.slice(5)}`; };
const norm = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCode = (uid, c) => sha(`${uid}:${norm(c)}`);

async function makeBackupCodes(admin, uid) {
  const codes = Array.from({ length: 8 }, newCode);
  await admin.from('mfa_backup_codes').delete().eq('user_id', uid);
  await admin.from('mfa_backup_codes').insert(codes.map((c) => ({ user_id: uid, code_hash: hashCode(uid, c) })));
  return codes;
}

export async function POST(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req);
  const sb = await userClient();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return bad('Sign in again', 401);
  const uid = u.user.id;
  const admin = adminClient();
  const ip = clientIp(req);
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  const { data: fl } = await sb.auth.mfa.listFactors();
  const verified = (fl?.totp || [])[0];                                  // listFactors().totp holds verified factors only
  const unverified = (fl?.all || []).filter((f) => f.factor_type === 'totp' && f.status === 'unverified');
  const code6 = String(b.code || '').replace(/\s/g, '');

  switch (b.action) {
    case 'status': {
      const { count } = await admin.from('mfa_backup_codes').select('id', { count: 'exact', head: true }).eq('user_id', uid).is('used_at', null);
      return ok({ enrolled: Boolean(verified), aal: aal?.currentLevel, backupLeft: count || 0 });
    }

    case 'enroll': {
      if (verified && aal?.currentLevel !== 'aal2') return bad('Enter your authenticator code first.', 403, { mfa: true });
      if (verified) return bad('Two-step verification is already on.');
      for (const f of unverified) await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Uzaa ${Date.now().toString(36)}` });
      if (error) return bad('Could not start setup. Try again.');
      return ok({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    }

    case 'confirm': {   // first code after scanning the QR: turns 2FA on and shows backup codes once
      const l = await hit('otp', uid, LIMITS.otpUser); if (l) return l;
      if (!/^\d{6}$/.test(code6) || !b.factorId) return bad('Enter the 6 digit code');
      if (!unverified.some((f) => f.id === b.factorId)) return bad('Start setup again');
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: b.factorId, code: code6 });
      await logEvent(admin, 'mfa_enrol', { ip, success: !error });
      if (error) return bad('That code is wrong. Check the time on your phone and try again.');
      return ok({ backupCodes: await makeBackupCodes(admin, uid) });
    }

    case 'login': {     // second step of sign-in
      const l = await hit('otp', uid, LIMITS.otpUser); if (l) return l;
      if (!verified) return bad('Two-step verification is not set up');
      if (!/^\d{6}$/.test(code6)) return bad('Enter the 6 digit code');
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: verified.id, code: code6 });
      await logEvent(admin, 'mfa_login', { ip, success: !error });
      if (error) return bad('That code is wrong or has expired.', 401);
      return ok();
    }

    case 'backup': {    // lost phone: a backup code gets you in, then 2FA is reset and must be set up again
      const l = await hit('otp', uid, LIMITS.otpUser); if (l) return l;
      if (norm(b.code).length !== 10) return bad('Enter your backup code');
      const h = hashCode(uid, b.code);
      const { data: row } = await admin.from('mfa_backup_codes').select('id').eq('user_id', uid).eq('code_hash', h).is('used_at', null).maybeSingle();
      await logEvent(admin, 'mfa_backup', { ip, success: Boolean(row) });
      if (!row) return bad('That backup code is wrong or already used.', 401);
      await admin.from('mfa_backup_codes').delete().eq('user_id', uid);
      for (const f of fl?.all || []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: uid });
      await sb.auth.refreshSession();
      return ok({ reset: true, next: '/security?setup=1&reset=1' });
    }

    case 'regen': {
      if (!verified || aal?.currentLevel !== 'aal2') return bad('Enter your authenticator code first.', 403, { mfa: true });
      const l = await hit('otp', uid, LIMITS.otpUser); if (l) return l;
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: verified.id, code: code6 });
      if (error) return bad('That code is wrong or has expired.', 401);
      return ok({ backupCodes: await makeBackupCodes(admin, uid) });
    }

    case 'disable': {
      const { data: prof } = await sb.from('profiles').select('role').eq('id', uid).maybeSingle();
      if (prof?.role === 'super_admin') return bad('Two-step verification cannot be turned off for this account.', 403);
      if (!verified || aal?.currentLevel !== 'aal2') return bad('Enter your authenticator code first.', 403, { mfa: true });
      const l = await hit('otp', uid, LIMITS.otpUser); if (l) return l;
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: verified.id, code: code6 });
      if (error) return bad('That code is wrong or has expired.', 401);
      const { error: ue } = await sb.auth.mfa.unenroll({ factorId: verified.id });
      if (ue) return bad('Could not turn it off. Try again.');
      await admin.from('mfa_backup_codes').delete().eq('user_id', uid);
      await logEvent(admin, 'mfa_disable', { ip, success: true });
      await sb.auth.refreshSession();
      return ok();
    }
    default: return bad('Unknown action');
  }
}
