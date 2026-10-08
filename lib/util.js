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
    custom_fields: [{ key: 'unit', label: 'Unit', type: 'text' }],
  },
  other: { label: 'Other', item_label: 'Product', custom_fields: [] },
};
