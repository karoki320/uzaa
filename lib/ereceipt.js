import { createHmac, timingSafeEqual } from 'node:crypto';

// Links to the online e-receipt. They are sent to customers on WhatsApp and must keep working for good
// (returns, warranty), so they never expire. Each one is tied to one sale and signed, so nobody can
// guess another sale's link. Changing RECEIPT_SECRET breaks every link already sent: set it once.
const secret = () => process.env.RECEIPT_SECRET || process.env.PRINT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const mac = (idHex) => createHmac('sha256', secret()).update(`ereceipt:${idHex}`).digest().subarray(0, 16).toString('base64url');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Short token: the sale id (16 bytes) and a 16 byte signature, both base64url. About 45 characters. */
export function signReceipt(saleId) {
  if (!UUID.test(String(saleId))) return '';
  const hex = saleId.replace(/-/g, '').toLowerCase();
  return `${Buffer.from(hex, 'hex').toString('base64url')}.${mac(hex)}`;
}

/** The sale id inside a valid token, or null. */
export function readReceipt(token) {
  try {
    const [a, sig] = String(token || '').split('.');
    if (!a || !sig || a.length !== 22) return null;
    const hex = Buffer.from(a, 'base64url').toString('hex');
    if (hex.length !== 32) return null;
    const x = Buffer.from(mac(hex)); const y = Buffer.from(sig);
    if (x.length !== y.length || !timingSafeEqual(x, y)) return null;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch { return null; }
}
