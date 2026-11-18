// Uzaa's price list. One place: the signup page, the owner's Billing page and the server all read it.
// Change a price here and every new checkout uses it. Clients the admin priced by hand keep their own price.
export const PLANS = {
  standard: { name: 'Uzaa POS Standard', prices: { week: 250, month: 900, quarter: 2500 } },
  // pay: { name: 'Uzaa Pay', prices: { quarter: 5000 } },   // coming later
};
export const TRIAL_DAYS = 7;
export const PERIODS = ['week', 'month', 'quarter'];
export const PER = { week: 'week', month: 'month', quarter: 'quarter (3 months)', year: 'year' };
export const PER_SHORT = { week: 'wk', month: 'mo', quarter: 'qtr', year: 'yr' };
export const listPrice = (code, period) => PLANS[code]?.prices?.[period] ?? null;
/** True when this subscription is on the published price list (so the owner may switch period themselves). */
export const onList = (sub) => !!sub && sub.plan_code === 'standard' && listPrice('standard', sub.period) === Number(sub.fee);
