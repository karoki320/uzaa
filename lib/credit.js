// What a shop calls "take now, pay later" (patch 24, businesses.credit_style).
// The payment method stored on the sale is always 'Credit'; only the words change.
export const partStyle = (b) => b?.credit_style === 'part';
export const creditWord = (b) => (partStyle(b) ? 'Part payment' : 'Credit');
export const creditSection = (b) => (partStyle(b) ? 'Part payments' : 'Credit');
// a payment method as the shop says it
export const methodName = (m, b) => (String(m || '').toLowerCase() === 'credit' ? creditWord(b) : m || '');
