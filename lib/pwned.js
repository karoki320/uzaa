import { createHash } from 'node:crypto';
import { passwordIssue } from './password-rules';

/** Checks the password against known data breaches using k-anonymity: only the first 5 characters of the SHA-1 hash leave the server. Fails open if the service is down. */
export async function isPwned(pw) {
  try {
    const h = createHash('sha1').update(pw).digest('hex').toUpperCase();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' }, signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!r.ok) return false;
    const text = await r.text();
    const suffix = h.slice(5);
    return text.split('\n').some((l) => { const [s, c] = l.trim().split(':'); return s === suffix && Number(c) > 0; });
  } catch { return false; }
}

/** Full server-side check. Returns an error message or null. */
export async function checkPassword(pw, email = '') {
  const issue = passwordIssue(pw, email);
  if (issue) return issue;
  if (await isPwned(pw)) return 'That password has appeared in a data breach. Choose a different one.';
  return null;
}
