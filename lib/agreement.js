import { randomBytes, createHash } from 'node:crypto';
import { Pdf, jpegSize } from './pdf';

// The Uzaa service agreement: one wording, used for the signing page and for the PDF, so what the client
// reads on the phone is exactly what is in the file. The wording is copied into each agreement when it is
// sent, so editing this template later never changes an agreement someone has already been sent or signed.

export const TEMPLATE_VERSION = '2026-11';

export const provider = () => ({
  name: process.env.AGREEMENT_PROVIDER_NAME || 'The Biziirise Solutions',
  address: process.env.AGREEMENT_PROVIDER_ADDRESS || 'Nairobi, Kenya',
  email: process.env.AGREEMENT_PROVIDER_EMAIL || 'hello@biziirise.com',
  phone: process.env.AGREEMENT_PROVIDER_PHONE || '',
  signatory: process.env.AGREEMENT_SIGNATORY || '',
  title: process.env.AGREEMENT_SIGNATORY_TITLE || 'Director',
});

export const newToken = () => randomBytes(24).toString('base64url');
export const sha256 = (b) => createHash('sha256').update(b).digest('hex');
export const tokenOk = (t) => /^[A-Za-z0-9_-]{32}$/.test(String(t || ''));

const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const longDate = (d) => new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi' }).format(new Date(d));
export const stamp = (d) => new Intl.DateTimeFormat('en-KE', { dateStyle: 'long', timeStyle: 'medium', timeZone: 'Africa/Nairobi' }).format(new Date(d)) + ' (EAT)';

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const money = (v) => { const n = Number(String(v ?? '').replace(/[, ]/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };
const int = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** The commercial terms the admin fills in, checked and with defaults. */
export function cleanTerms(t = {}) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(t.start_date || '')) ? t.start_date : new Date().toISOString().slice(0, 10);
  return {
    plan: str(t.plan, 60) || 'Uzaa POS Standard',
    setup_fee: money(t.setup_fee),
    fee: money(t.fee),
    period: ['quarter', 'year'].includes(t.period) ? t.period : 'month',
    start_date: start,
    term_months: int(t.term_months, 1, 60, 12),
    branches: int(t.branches, 1, 100, 1),
    notice_days: int(t.notice_days, 7, 180, 30),
    payment: str(t.payment, 300),
    special: str(t.special, 3000),
  };
}

/** The agreement as blocks: h = heading, p = paragraph, li = bullet, kv = label/value rows. */
export function buildContent(c, t) {
  const p = provider();
  const who = `${c.client_name}${c.client_id_no ? ` (ID/Registration/PIN: ${c.client_id_no})` : ''}`;
  const trading = c.client_business && c.client_business !== c.client_name ? `, trading as ${c.client_business}` : '';
  const per = ['quarter', 'year'].includes(t.period) ? t.period : 'month';
  const perLong = per === 'quarter' ? 'quarter (every 3 months)' : per;
  const n = { i: 0 };
  const H = (s) => ({ t: 'h', s: `${++n.i}. ${s}` });
  const blocks = [
    H('Parties'),
    { t: 'p', s: `This Service Agreement ("Agreement") is made between ${p.name.toUpperCase()} of ${p.address} (the "Provider"), the owner and operator of the Uzaa point of sale platform, and ${who}${trading}${c.client_address ? `, of ${c.client_address}` : ''} (the "Client").` },
    H('Background'),
    { t: 'p', s: 'The Provider has developed and operates Uzaa, an online point of sale and business management system. The Client wishes to use Uzaa in its business on the terms below, and the Provider has agreed to provide it.' },
    H('The Services'),
    { t: 'p', s: `The Provider will give the Client access to Uzaa under the ${t.plan} plan for up to ${t.branches} branch${t.branches > 1 ? 'es' : ''} (the "Services"), which include:` },
    { t: 'li', s: 'selling at the till, receipts (printed and on WhatsApp), credit sales and payment records;' },
    { t: 'li', s: 'products, stock levels, stock movements and barcode scanning;' },
    { t: 'li', s: 'staff logins with roles (owner, manager, cashier) and reports on sales and performance;' },
    { t: 'li', s: 'an offline mode that keeps the till selling and uploads sales when the connection returns;' },
    { t: 'li', s: 'account set-up, guidance on first use, updates and improvements released to all Uzaa users.' },
    { t: 'p', s: 'Computers, phones, printers, scanners, internet and electricity are the Client\'s own unless the Provider agrees otherwise in writing.' },
    H('Commencement, Activation and Term'),
    { t: 'p', s: `This Agreement starts on ${longDate(t.start_date)} and runs for a minimum term of ${t.term_months} month${t.term_months > 1 ? 's' : ''}. After that it continues from ${per} to ${per}${per === 'quarter' ? ' (3 months at a time)' : ''} until either party ends it by giving ${t.notice_days} days' written notice.` },
    { t: 'p', s: 'The Client\'s account is activated by the Provider after this Agreement is signed and any set-up fee due has been received.' },
    H('Fees and Payment'),
    { t: 'kv', rows: [
      ['Plan', t.plan],
      ['Set-up fee (once)', t.setup_fee ? kes(t.setup_fee) : 'None'],
      [`Subscription per ${per}`, per === "quarter" ? `${kes(t.fee)} (every 3 months)` : kes(t.fee)],
      ...(t.payment ? [['How to pay', t.payment]] : []),
    ] },
    { t: 'p', s: `Fees are in Kenya Shillings and are payable in advance at the start of each ${perLong}. If a payment is more than 14 days late, the Provider may, after giving written notice, suspend access until it is paid. The Client's data is kept safe during any suspension. The Provider may change its fees by giving at least 30 days' written notice; the change does not apply during the minimum term.` },
    H('The Client\'s Responsibilities'),
    { t: 'li', s: 'give accurate business information and keep its prices, products and stock records correct;' },
    { t: 'li', s: 'keep all passwords and sign-in codes private, and remove access for staff who leave;' },
    { t: 'li', s: 'remain responsible for what its staff do in Uzaa under their logins;' },
    { t: 'li', s: 'use Uzaa lawfully, and remain responsible for its own tax obligations, including any Kenya Revenue Authority requirements;' },
    { t: 'li', s: 'tell the Provider promptly of any suspected misuse of its account.' },
    H('The Provider\'s Responsibilities'),
    { t: 'p', s: 'The Provider will provide the Services with reasonable skill and care, use reasonable efforts to keep Uzaa available at all times except for planned maintenance and events outside its control, keep regular backups of the Client\'s data, and give support by WhatsApp, phone or email during business hours.' },
    H('Data Protection'),
    { t: 'p', s: 'Data the Client enters into Uzaa belongs to the Client. For personal data (for example customer names and phone numbers), the Client is the data controller and the Provider is the data processor under the Data Protection Act, 2019. The Provider will process that data only to provide the Services, keep it secure with appropriate technical and organisational measures, not sell it, and notify the Client without undue delay of any breach affecting it.' },
    H('Confidentiality'),
    { t: 'p', s: 'Each party will keep the other\'s confidential information private and use it only for this Agreement. This continues after the Agreement ends.' },
    H('Intellectual Property'),
    { t: 'p', s: 'Uzaa, its software, designs and brand remain the property of the Provider. The Client receives a non-exclusive, non-transferable right to use Uzaa for its own business during this Agreement. The Client keeps all rights in its own data, name and logo.' },
    H('Limitation of Liability'),
    { t: 'p', s: 'Neither party is liable for indirect or consequential loss, or for loss of profit or business. The Provider\'s total liability under this Agreement is limited to the fees paid by the Client in the three months before the claim. Nothing in this Agreement limits liability that cannot be limited by law.' },
    H('Termination'),
    { t: 'p', s: `Either party may end this Agreement after the minimum term with ${t.notice_days} days' written notice, or at once if the other party materially breaches it and does not put the breach right within 14 days of written notice. On termination the Client may export its data for 30 days, after which the Provider may delete it. Fees already due remain payable.` },
    H('Electronic Signature'),
    { t: 'p', s: 'The parties agree that this Agreement may be signed electronically. The Client\'s electronic signature, typed name and the signing record (date, time and internet address) have the same effect as a handwritten signature, in line with the Kenya Information and Communications Act (Cap. 411A) and the Law of Contract Act (Cap. 23).' },
    H('Disputes and Governing Law'),
    { t: 'p', s: 'The parties will first try to settle any dispute by good-faith discussion within 14 days, then by mediation in Nairobi. If that fails, either party may go to the courts of Kenya. This Agreement is governed by the laws of Kenya.' },
    H('General'),
    { t: 'p', s: `This Agreement is the whole agreement between the parties about the Services. Changes must be in writing and agreed by both parties. The Client may not transfer this Agreement without the Provider's consent. If any part is found invalid, the rest stays in force. Neither party is liable for delay caused by events outside its reasonable control. Notices may be sent by email to ${p.email} for the Provider and to ${c.client_email || 'the Client\'s registered email'} for the Client.` },
  ];
  if (t.special) {
    blocks.push(H('Special Terms'));
    for (const line of t.special.split(/\n+/).map((x) => x.trim()).filter(Boolean)) blocks.push({ t: 'p', s: line });
    blocks.push({ t: 'p', s: 'If a special term conflicts with any other clause, the special term applies.' });
  }
  return blocks;
}

/** Creates the stored snapshot for a new generated agreement. */
export function snapshot(client, rawTerms) {
  const terms = cleanTerms(rawTerms);
  const content = buildContent(client, terms);
  const p = provider();
  const body = { v: TEMPLATE_VERSION, provider: p, client, terms, content };
  return { terms: { ...terms, content, provider: p, v: TEMPLATE_VERSION }, doc_hash: sha256(JSON.stringify(body)) };
}

export const nextRef = (count) => `UZA-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

// ---------------------------------------------------------------------------------------------
// PDF
const BLUE = '#0b5c87'; const MUTED = '#5b6472';

function header(pdf, a, title) {
  const p = a.terms?.provider || provider();
  pdf.rect(0, 841.89 - 6, 595.28, 6, { fill: BLUE });
  pdf.space(4);
  pdf.para(p.name.toUpperCase(), { size: 9, font: 'B', color: BLUE, gap: 0 });
  pdf.para(`${p.address}${p.email ? ` · ${p.email}` : ''}${p.phone ? ` · ${p.phone}` : ''}`, { size: 8, color: MUTED, gap: 10 });
  pdf.para(title, { size: 18, font: 'B', gap: 2 });
  pdf.para(`Uzaa point of sale · Ref ${a.ref || '-'}`, { size: 10, color: MUTED, gap: 4 });
  pdf.rule({ gap: 6 });
}

function signatureBlock(pdf, a) {
  const p = a.terms?.provider || provider();
  pdf.need(230);
  pdf.heading('Signed by the parties', { size: 12 });
  const col = (pdf.width - 20) / 2;
  const top = pdf.y;
  const x1 = pdf.m; const x2 = pdf.m + col + 20;
  // Provider
  pdf.text('For the Provider', x1, top - 14, { size: 9, font: 'B', color: MUTED });
  pdf.text(p.name, x1, top - 30, { size: 10, font: 'B' });
  pdf.text(p.signatory ? `${p.signatory}, ${p.title}` : `Authorised signatory, ${p.title}`, x1, top - 44, { size: 9 });
  pdf.text(`Issued electronically on ${stamp(a.sent_at || a.created_at || Date.now())}`, x1, top - 58, { size: 8, color: MUTED });
  // Client
  pdf.text('For the Client', x2, top - 14, { size: 9, font: 'B', color: MUTED });
  if (a.status === 'signed' && a.signature) {
    const buf = Buffer.from(String(a.signature).split(',')[1] || '', 'base64');
    pdf.rect(x2, top - 112, col, 90, { stroke: '#d8d2c2' });
    const sz = jpegSize(buf);
    const k = sz ? Math.min((col - 12) / sz.w, 78 / sz.h) : 1;
    const okImg = sz && pdf.jpeg(buf, x2 + 6 + (col - 12 - sz.w * k) / 2, top - 106 + (78 - sz.h * k) / 2, sz.w * k, sz.h * k);
    if (!okImg) pdf.text('[signature on record]', x2 + 8, top - 70, { size: 9, color: MUTED });
    pdf.text(a.signer_name, x2, top - 128, { size: 10, font: 'B' });
    if (a.signer_title) pdf.text(a.signer_title, x2, top - 142, { size: 9 });
    pdf.text(`Signed electronically on ${stamp(a.signed_at)}`, x2, top - (a.signer_title ? 156 : 142), { size: 8, color: MUTED });
  } else {
    pdf.rect(x2, top - 112, col, 90, { stroke: '#d8d2c2' });
    pdf.text('Awaiting the Client\'s signature', x2 + 8, top - 70, { size: 9, font: 'I', color: MUTED });
    pdf.text(a.client_name || '', x2, top - 128, { size: 10, font: 'B' });
  }
  pdf.y = top - 170;
}

function auditTrail(pdf, a, docName) {
  pdf.need(200);
  pdf.rule({ gap: 8 });
  pdf.heading('Signing record', { size: 11 });
  pdf.rows([
    ['Agreement reference', a.ref || '-'],
    ...(docName ? [['Document', docName]] : []),
    ['Document fingerprint (SHA-256)', a.doc_hash || '-'],
    ['Sent to', [a.client_name, a.client_email, a.client_phone].filter(Boolean).join(' · ')],
    ['Sent', stamp(a.sent_at || a.created_at)],
    ['First opened', a.viewed_at ? stamp(a.viewed_at) : 'Not yet'],
    ['Signed', a.signed_at ? stamp(a.signed_at) : 'Not yet'],
    ...(a.signed_at ? [['Signed by', `${a.signer_name}${a.signer_title ? `, ${a.signer_title}` : ''}`], ['Internet address', a.signer_ip || '-'], ['Device', (a.signer_agent || '-').slice(0, 160)]] : []),
  ], { size: 8.5, labelW: 165, gap: 2 });
  pdf.para('The fingerprint identifies the exact wording the Client was shown. Any change to the wording would produce a different fingerprint.', { size: 8, color: MUTED, gap: 0 });
}

/** The full agreement (generated kind), signed or not. */
export function agreementPdf(a) {
  const p = a.terms?.provider || provider();
  const pdf = new Pdf({ title: `Service Agreement ${a.ref || ''} - ${a.client_business || a.client_name}`, author: p.name, footer: `Uzaa Service Agreement ${a.ref || ''}` });
  header(pdf, a, 'Software Service Agreement');
  pdf.rows([
    ['Client', a.client_name],
    ['Business', a.client_business],
    ['Contacts', [a.client_email, a.client_phone].filter(Boolean).join(' · ')],
  ], { size: 10, labelW: 90, gap: 2 });
  pdf.space(6);
  for (const b of a.terms?.content || []) {
    if (b.t === 'h') pdf.heading(b.s, { size: 11.5 });
    else if (b.t === 'li') pdf.bullet(b.s);
    else if (b.t === 'kv') { pdf.space(2); pdf.rows(b.rows, { size: 10, labelW: 160, gap: 2 }); pdf.space(4); }
    else pdf.para(b.s, { size: 10 });
  }
  pdf.space(8);
  signatureBlock(pdf, a);
  auditTrail(pdf, a);
  return pdf.toBuffer();
}

/** For an uploaded agreement: a certificate of signature that goes with the original file. */
export function certificatePdf(a) {
  const p = a.terms?.provider || provider();
  const pdf = new Pdf({ title: `Signature certificate ${a.ref || ''}`, author: p.name, footer: `Uzaa signature certificate ${a.ref || ''}` });
  header(pdf, a, 'Certificate of Electronic Signature');
  pdf.para(`This certificate records the electronic signing of the agreement "${a.doc_name || 'Service agreement'}" between ${p.name} and ${a.client_name}${a.client_business && a.client_business !== a.client_name ? ` (${a.client_business})` : ''}. It forms part of that agreement and should be kept with it.`, { size: 10, gap: 10 });
  signatureBlock(pdf, a);
  auditTrail(pdf, a, a.doc_name || 'Uploaded agreement (PDF)');
  return pdf.toBuffer();
}

export const fileName = (a, suffix = '') => `${(a.ref || 'agreement')}-${String(a.client_business || a.client_name || 'client').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}${suffix}.pdf`;
