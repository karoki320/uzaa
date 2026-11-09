// The WhatsApp message that goes with an e-receipt. Shared by the till, the Sales screen and the Settings preview.
export const DEFAULT_ERECEIPT_MESSAGE =
  'Hi {customer}, thank you for shopping with {business}!\n\nYour receipt #{receipt} for {total} is here:\n{link}\n\nWe look forward to seeing you again.';

export const ERECEIPT_TAGS = ['{customer}', '{business}', '{receipt}', '{total}', '{date}', '{link}'];

export const hexOk = (c) => /^#[0-9a-fA-F]{6}$/.test(String(c || ''));
export const urlOk = (u) => /^https?:\/\/[^\s]+\.[^\s]+$/i.test(String(u || '').trim());

/** Fills the owner's template. The receipt link is always included, and the extra link is added at the end. */
export function ereceiptMessage(business, { customer, receipt, total, date, link }) {
  const tpl = String(business?.ereceipt_message || '').trim() || DEFAULT_ERECEIPT_MESSAGE;
  const vals = {
    customer: String(customer || '').trim() || 'there',
    business: business?.name || '',
    receipt: receipt ?? '',
    total: total ?? '',
    date: date ?? '',
    link: link || '',
  };
  let msg = tpl.replace(/\{(customer|business|receipt|total|date|link)\}/g, (_, k) => String(vals[k]));
  if (link && !tpl.includes('{link}')) msg += `\n\nYour receipt: ${link}`;
  const xl = String(business?.ereceipt_link_url || '').trim();
  if (xl && urlOk(xl)) msg += `\n\n${String(business?.ereceipt_link_label || '').trim() || 'Visit us'}: ${xl}`;
  return msg;
}
