export const money = (n, cur = 'KES') =>
  `${cur} ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const num = (n) => Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });

export const fmtDate = (d) =>
  new Date(d).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });

export const isoDate = (d) => {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${m}-${day}`;
};

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const monday = (d) => {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7;
  return addDays(x, -dow);
};

export const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'thisweek', label: 'This week' },
  { key: 'lastweek', label: 'Last week' },
  { key: 'last30', label: 'Last 30 days' },
];

export function rangeFor(key) {
  const now = new Date();
  if (key === 'today') return { from: startOfDay(now), to: addDays(startOfDay(now), 1) };
  if (key === 'lastweek') {
    const m = monday(now);
    return { from: addDays(m, -7), to: m };
  }
  if (key === 'last7') return { from: addDays(startOfDay(now), -6), to: addDays(startOfDay(now), 1) };
  if (key === 'last30') return { from: addDays(startOfDay(now), -29), to: addDays(startOfDay(now), 1) };
  const m = monday(now);
  return { from: m, to: addDays(m, 7) };
}

export const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

export const TYPE_PRESETS = {
  retail: { label: 'Retail shop / duka', item_label: 'Product', custom_fields: [] },
  pharmacy: {
    label: 'Pharmacy',
    item_label: 'Medicine',
    custom_fields: [
      { key: 'expiry_date', label: 'Expiry date', type: 'date' },
      { key: 'batch_no', label: 'Batch number', type: 'text' },
    ],
  },
  restaurant: { label: 'Restaurant / cafe', item_label: 'Menu item', custom_fields: [] },
  salon: { label: 'Salon / services', item_label: 'Service', custom_fields: [] },
  hardware: {
    label: 'Hardware',
    item_label: 'Item',
    custom_fields: [],
  },
  other: { label: 'Other', item_label: 'Product', custom_fields: [] },
};

// Units a product can be sold in. Anything not listed can be typed as a custom unit.
export const UNITS = [
  ['pc', 'Piece'], ['kg', 'Kilogram (kg)'], ['g', 'Gram (g)'], ['litre', 'Litre'], ['ml', 'Millilitre (ml)'],
  ['m', 'Metre (m)'], ['pack', 'Pack'], ['box', 'Box'], ['dozen', 'Dozen'], ['bottle', 'Bottle'], ['crate', 'Crate'], ['bag', 'Bag'],
];
export const unitLabel = (u) => (UNITS.find((x) => x[0] === u) || [u, u])[0];
// Whole-number units step by 1, measured units (litre, kg, m ...) step by 0.5 at the till.
export const WHOLE_UNITS = ['pc', 'pack', 'box', 'dozen', 'bottle', 'crate', 'bag'];
export const stepFor = (u) => (WHOLE_UNITS.includes(u || 'pc') ? 1 : 0.5);

// A Kenyan number typed any way (0722..., +254722..., 254722...) as a wa.me link.
export const waLink = (phone, text) => {
  const d = String(phone || '').replace(/\D/g, '');
  const n = d.startsWith('254') ? d : d.startsWith('0') ? `254${d.slice(1)}` : d.length === 9 ? `254${d}` : d;
  return n.length < 11 ? '' : `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
};
