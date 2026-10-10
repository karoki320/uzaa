import { adminClient, clientIp, hk, bad, logEvent } from './server';

// Tunable limits. Fixed windows live in Postgres (rl_hit), so they work across all serverless instances.
export const LIMITS = {
  loginIp:     { limit: 30, window: 900 },   // attempts per IP per 15 minutes (a shop's staff share one wifi address)
  signupIp:    { limit: 5,  window: 3600 },
  forgotIp:    { limit: 5,  window: 900 },
  forgotEmail: { limit: 3,  window: 3600 },
  magicIp:     { limit: 5,  window: 900 },
  magicEmail:  { limit: 3,  window: 3600 },
  resendIp:    { limit: 5,  window: 900 },
  resendEmail: { limit: 3,  window: 3600 },
  otpUser:     { limit: 6,  window: 900 },   // authenticator or backup code tries per account per 15 minutes
  reauthUser:  { limit: 3,  window: 3600 },  // emailed confirmation codes
  changeUser:  { limit: 6,  window: 900 },
  staffUser:   { limit: 30, window: 3600 },
};
export const CAPTCHA_AFTER = 3;   // failed sign-ins before a captcha is demanded
export const LOCK_AT = 10;        // failed sign-ins on one account before a 15 minute lock
export const IP_FREE = 10;        // an IP address (often a whole shop on one wifi) gets a much higher allowance
export const IP_LOCK_AT = 30;

export const captchaConfigured = () => Boolean(process.env.TURNSTILE_SECRET_KEY);

/** Returns a 429 response when over the limit, otherwise null. */
export async function hit(name, key, cfg) {
  const sb = adminClient();
  const { data, error } = await sb.rpc('rl_hit', { p_key: `${name}:${key}`, p_limit: cfg.limit, p_window: cfg.window });
  if (error) return bad('Service is busy. Try again shortly.', 503);
  const r = Array.isArray(data) ? data[0] : data;
  if (r && !r.allowed) {
    const mins = Math.max(1, Math.ceil(r.retry_after / 60));
    return bad(`Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 429, { retry_after: r.retry_after });
  }
  return null;
}
export const hitIp = (name, req, cfg) => hit(name, `ip:${clientIp(req)}`, cfg);
export const hitEmail = (name, email, cfg) => hit(name, `em:${hk(email)}`, cfg);

export async function verifyCaptcha(token, ip) {
  if (!captchaConfigured()) return true;
  if (!token || typeof token !== 'string' || token.length > 4000) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
    });
    const j = await r.json();
    return j.success === true;
  } catch { return false; }
}

export const loginKeys = (req, email) => ({ acct: `acct:${hk(email)}`, ip: `ip:${clientIp(req)}` });
export async function lockState(key) {
  const sb = adminClient();
  const { data } = await sb.rpc('la_status', { p_key: key });
  const r = Array.isArray(data) ? data[0] : data;
  const lockedFor = r?.locked_until ? Math.max(0, Math.ceil((new Date(r.locked_until) - Date.now()) / 1000)) : 0;
  return { failures: r?.failures || 0, lockedFor };
}
export async function noteFailure(key, free = CAPTCHA_AFTER, lockAt = LOCK_AT) {
  const sb = adminClient();
  const { data } = await sb.rpc('la_fail', { p_key: key, p_free: free, p_lock_at: lockAt });
  const r = Array.isArray(data) ? data[0] : data;
  return { failures: r?.failures || 0 };
}
export const clearFailures = (key) => adminClient().rpc('la_reset', { p_key: key });
export { logEvent };
