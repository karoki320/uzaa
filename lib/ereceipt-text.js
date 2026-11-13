// The WhatsApp message that goes with an e-receipt. Shared by the till, the Sales screen and the Settings preview.
export const DEFAULT_ERECEIPT_MESSAGE =
  'Hi {customer}, thank you for shopping with {business}!\n\nYou bought:\n{items}\n\nYour receipt #{receipt} for {total} is here:\n{link}\n\nWe look forward to seeing you again.';

export const ERECEIPT_TAGS = ['{customer}', '{business}', '{items}', '{receipt}', '{total}', '{date}', '{link}'];

const n2 = (v) => Number(v || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });
/** One line per item: "- Kenya Love: 30 ml x 33.33 = 1,000" */
export function itemLines(items = []) {
  return items.map((it) => `- ${it.name}: ${n2(it.qty)}${it.unit && it.unit !== 'pc' ? ` ${it.unit}` : ''} x ${n2(it.price)} = ${n2(Number(it.qty) * Number(it.price))}`).join('\n');
}

export const hexOk = (c) => /^#[0-9a-fA-F]{6}$/.test(String(c || ''));
export const urlOk = (u) => /^https?:\/\/[^\s]+\.[^\s]+$/i.test(String(u || '').trim());

/** Fills the owner's template. The receipt link is always included, and the extra link is added at the end. */
export function ereceiptMessage(business, { customer, receipt, total, date, link, items }) {
  const tpl = String(business?.ereceipt_message || '').trim() || DEFAULT_ERECEIPT_MESSAGE;
  const vals = {
    customer: String(customer || '').trim() || 'there',
    business: business?.name || '',
    receipt: receipt ?? '',
    total: total ?? '',
    date: date ?? '',
    link: link || '',
    items: itemLines(items || []),
  };
  let msg = tpl.replace(/\{(customer|business|items|receipt|total|date|link)\}/g, (_, k) => String(vals[k]));
  // owners' own messages written before {items} existed still get the breakdown
  if (vals.items && !tpl.includes('{items}')) msg += `\n\nYou bought:\n${vals.items}`;
  if (link && !tpl.includes('{link}')) msg += `\n\nYour receipt: ${link}`;
  const xl = String(business?.ereceipt_link_url || '').trim();
  if (xl && urlOk(xl)) msg += `\n\n${String(business?.ereceipt_link_label || '').trim() || 'Visit us'}: ${xl}`;
  return msg;
}
