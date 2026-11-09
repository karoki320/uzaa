import { newToken, nextRef, snapshot, sha256 } from './agreement';

// Shared by onboarding and "send an agreement" for an existing business.
// Light columns for lists: never the uploaded file or the signature image.
export const LIST_COLS = 'id,business_id,token,kind,ref,client_name,client_business,client_email,client_phone,doc_name,status,sent_at,viewed_at,signed_at,signer_name,created_at';

export const siteUrl = (req) => process.env.PUBLIC_SITE_URL?.replace(/\/$/, '') || new URL(req.url).origin;

const MAX_PDF = 3 * 1024 * 1024;

/** Checks the agreement part of a request. Returns { error } or { mode, pdf, pdf_name }. */
export function readAgreementInput(a = {}) {
  const mode = ['generate', 'upload', 'none'].includes(a.mode) ? a.mode : 'none';
  if (mode !== 'upload') return { mode };
  const raw = String(a.pdf || '').replace(/^data:application\/pdf;base64,/, '');
  let buf;
  try { buf = Buffer.from(raw, 'base64'); } catch { return { error: 'That file could not be read' }; }
  if (!buf.length) return { error: 'Choose the agreement PDF to upload' };
  if (buf.length > MAX_PDF) return { error: 'That PDF is larger than 3 MB. Compress it and try again.' };
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { error: 'That file is not a PDF' };
  const name = String(a.pdf_name || 'agreement.pdf').replace(/[^\w .()-]/g, '').slice(0, 100) || 'agreement.pdf';
  return { mode, buf, pdf_name: name };
}

/** Inserts the agreement. `client` holds client_name, client_business, client_email, client_phone, client_address, client_id_no. */
export async function createAgreement(sb, { businessId, client, input, terms, by }) {
  const { count } = await sb.from('agreements').select('id', { count: 'exact', head: true });
  const row = {
    business_id: businessId, token: newToken(), ref: nextRef(count || 0), created_by: by,
    client_name: client.client_name || '', client_business: client.client_business || '',
    client_email: client.client_email || '', client_phone: client.client_phone || '',
    client_address: client.client_address || '', client_id_no: client.client_id_no || '',
  };
  if (input.mode === 'upload') {
    Object.assign(row, { kind: 'uploaded', doc_pdf: input.buf.toString('base64'), doc_name: input.pdf_name, doc_hash: sha256(input.buf), terms: {} });
  } else {
    const s = snapshot(client, terms);
    Object.assign(row, { kind: 'generated', terms: s.terms, doc_hash: s.doc_hash });
  }
  const { data, error } = await sb.from('agreements').insert(row).select(LIST_COLS).single();
  if (error) return { error: error.message.includes('agreements') && error.message.includes('exist') ? 'Run supabase/security-patch-12.sql first' : 'Could not save the agreement' };
  return { agreement: data };
}

export const clientFrom = (b) => ({
  client_name: String(b.owner_name || b.client_name || '').trim().slice(0, 120),
  client_business: String(b.name || b.client_business || '').trim().slice(0, 120),
  client_email: String(b.owner_email || b.client_email || '').trim().toLowerCase().slice(0, 200),
  client_phone: String(b.owner_phone || b.client_phone || '').trim().slice(0, 20),
  client_address: String(b.client_address || '').trim().slice(0, 200),
  client_id_no: String(b.client_id_no || '').trim().slice(0, 40),
});
