import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Paystack, server side only. The secret key never reaches the browser.
// Test keys start with sk_test_, live keys with sk_live_. Amounts go to Paystack in cents (KES x 100).
const BASE = 'https://api.paystack.co';
const key = () => process.env.PAYSTACK_SECRET_KEY || '';

export const paystackReady = () => /^sk_(test|live)_/.test(key());
export const paystackTest = () => key().startsWith('sk_test_');
export const toCents = (n) => Math.round(Number(n) * 100);

async function call(path, { method = 'GET', body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(25000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status === false) {
    const e = new Error(j.message || `Paystack answered ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return j.data;
}

/** A reference nobody can guess, e.g. UZA-R-LZ3K9Q-9F2C1A7B. */
export const newRef = (tag) => `UZA-${tag}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`.toUpperCase();

/** Start a checkout. Paystack shows M-Pesa and card (whatever is switched on in the dashboard). */
export const initialize = ({ email, amount, currency, reference, callback_url, metadata }) =>
  call('/transaction/initialize', { method: 'POST', body: { email, amount: toCents(amount), currency, reference, callback_url, metadata } });

/** The truth about a payment. Always ask Paystack; never trust the browser or the webhook body alone. */
export const verify = (reference) => call(`/transaction/verify/${encodeURIComponent(reference)}`);

/** Charge a card the client saved earlier. Only works with the email the card was first paid with. */
export const chargeCard = ({ email, amount, currency, authorization_code, reference, metadata }) =>
  call('/transaction/charge_authorization', { method: 'POST', body: { email, amount: toCents(amount), currency, authorization_code, reference, metadata } });

/** Webhooks are signed: HMAC SHA-512 of the exact body with the secret key. */
export function signatureOk(raw, sig) {
  if (!paystackReady() || !sig) return false;
  const want = createHmac('sha512', key()).update(raw).digest('hex');
  const a = Buffer.from(want), b = Buffer.from(String(sig));
  return a.length === b.length && timingSafeEqual(a, b);
}
