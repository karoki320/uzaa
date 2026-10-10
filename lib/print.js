import { createHmac, timingSafeEqual } from 'node:crypto';
import { num } from './util';

// Print links for the "Bluetooth Print" Android app. The app fetches the link itself (no login),
// so each link is signed, tied to one sale, and expires.
const secret = () => process.env.PRINT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TTL = 30 * 60;   // seconds
const b64 = (s) => Buffer.from(s).toString('base64url');
const mac = (s) => createHmac('sha256', secret()).update(s).digest('base64url');

export function signPrint(saleId, width = 32) {
  const w = width === 48 ? 48 : 32;
  const body = b64(JSON.stringify({ s: saleId, e: Math.floor(Date.now() / 1000) + TTL, w }));
  return `${body}.${mac(body)}`;
}
export function readPrint(token) {
  try {
    const [body, sig] = String(token).split('.');
    const a = Buffer.from(mac(body)); const b = Buffer.from(sig || '');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.s || p.e < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}

const raw = (s) => String(s ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '');
const ascii = (s) => raw(s).trim();
// Servers run in UTC; receipts must show Nairobi time.
const when = (d) => new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(new Date(d));
const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);
const lr = (l, r, w) => { l = raw(l).trimEnd(); r = ascii(r); const room = Math.max(1, w - r.length - 1); return `${clip(l, room).padEnd(room)} ${r}`; };

/** Builds the JSON the Bluetooth Print app expects: an object keyed "0","1",... each with type/content/bold/align/format. */
export function buildJob({ business, branch, sale, items, cashier }, w = 32) {
  const out = [];
  const t = (content, o = {}) => out.push({ type: 0, content: ascii(content) || ' ', bold: o.bold ? 1 : 0, align: o.align ?? 0, format: o.format ?? 0 });
  const rule = () => t('-'.repeat(w));
  const cur = business?.currency || 'KES';
  const change = Math.max(0, Number(sale.amount_paid || 0) - Number(sale.total || 0));

  t(business?.name || 'Receipt', { bold: true, align: 1, format: 1 });
  if (branch?.name) t(branch.name, { align: 1 });
  if (branch?.address) t(branch.address, { align: 1 });
  if (branch?.phone) t(`Tel ${branch.phone}`, { align: 1 });
  if (business?.receipt_header) String(business.receipt_header).split('\n').forEach((l) => t(l, { align: 1 }));
  rule();
  t(`Receipt #${sale.receipt_no}`, { bold: true });
  t(when(sale.created_at));
  if (cashier) t(`Served by ${cashier}`);
  rule();
  items.forEach((it) => {
    t(clip(ascii(it.name), w));
    t(lr(`  ${num(it.qty)}${it.unit && it.unit !== 'pc' ? ' ' + it.unit : ''} x ${num(it.price)}`, num(it.qty * it.price), w));
  });
  rule();
  t(lr('Subtotal', num(sale.subtotal), w));
  if (Number(sale.discount) > 0) t(lr('Discount', `-${num(sale.discount)}`, w));
  if (Number(sale.tax) > 0) t(lr(`Tax (${num(business?.tax_rate)}%)`, num(sale.tax), w));
  t(lr(`TOTAL ${cur}`, num(sale.total), w), { bold: true, format: 1 });
  rule();
  t(lr(`Paid by ${sale.payment_method || ''}`, num(sale.amount_paid), w));
  if (change > 0) t(lr('Change', num(change), w));
  rule();
  if (business?.receipt_footer) String(business.receipt_footer).split('\n').forEach((l) => t(l, { align: 1 }));
  t('Powered by Uzaa', { align: 1, format: 4 });
  t(' '); t(' ');
  return Object.fromEntries(out.map((o, i) => [String(i), o]));
}
