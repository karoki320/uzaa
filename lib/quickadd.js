// Quick add at the till (patch 25): sell an item that is not in Products yet.
// Everything here runs on the phone against the product list the till already has,
// so it is instant and works with no signal.

const STOP = new Set(['the', 'and', 'with', 'for', 'of', 'a', 'an', 'big', 'small', 'medium', 'new', 'pc', 'pcs']);

// "Water Bottles (Blue)" -> "water bottle blue"
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('es') && /(ches|shes|sses|xes)$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}
const words = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w));

// edit distance, stops early once it is clearly too far
function lev(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
// two words are "the same" if equal or one small typo apart ("botle" ~ "bottle")
const near = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && lev(a, b, a.length >= 7 ? 2 : 1) <= (a.length >= 7 ? 2 : 1));

// how alike a typed name is to a product name: 0 (nothing) .. 1 (same)
export function likeness(typed, name) {
  const a = norm(typed), b = norm(name);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.replace(/\s/g, '') === b.replace(/\s/g, '')) return 0.98;          // "power bank" = "powerbank"
  const wa = words(typed), wb = words(name);
  if (!wa.length || !wb.length) return 0;
  const hit = wa.filter((w) => wb.some((x) => near(w, x))).length;
  let score = hit / Math.max(wa.length, wb.length);
  if (b.includes(a) || a.includes(b)) score = Math.max(score, 0.75);
  if (wa.length === 1 && wb.length === 1 && lev(a, b, 2) <= 2) score = Math.max(score, 0.85);
  return score;
}

// the closest products already in the shop ("Did you mean")
export function similar(typed, products, n = 3) {
  if (norm(typed).length < 2) return [];
  return products
    .map((p) => ({ p, s: likeness(typed, p.name) }))
    .filter((x) => x.s >= 0.5)
    .sort((x, y) => y.s - x.s || x.p.name.localeCompare(y.p.name))
    .slice(0, n)
    .map((x) => ({ ...x.p, same: x.s >= 0.98 }));
}

// Categories that describe how an item sells, not what it is. Never guessed for a new item.
const LABELS = new Set(['regular', 'fast moving', 'best sellers', 'best seller', 'popular', 'offers', 'offer']);
export const isLabel = (c) => LABELS.has(String(c || '').trim().toLowerCase());

// words -> the kind of category a shop usually has for them (used when the shop has nothing similar yet)
const KEYWORDS = [
  [/\b(tecno|infinix|itel|samsung|redmi|xiaomi|nokia|oppo|vivo|iphone|bontel|villaon|phone|smartphone)\b/, ['phones', 'phone']],
  [/\b(charger|cable|cover|protector|screen|guard|earphone|earbud|headphone|memory|flash|card|power ?bank|adapter|usb)\b/, ['accessories', 'phone & tech accessories', 'accessory']],
  [/\b(woofer|speaker|radio|sound ?bar|bluetooth|subwoofer|amplifier)\b/, ['audio', 'speakers', 'electronics']],
  [/\b(tv|television|decoder|aerial|remote|solar)\b/, ['tvs & solar', 'tv', 'tvs', 'electronics']],
  [/\b(bottle|flask|thermos|cup|mug|tumbler)\b/, ['bottles, flasks & cups', 'bottles', 'flasks', 'cups']],
  [/\b(umbrella)\b/, ['umbrellas', 'umbrella']],
  [/\b(blender|kettle|jug|sufuria|iron|toaster|cooker|dish|lunch ?box|jiko|pan|pot|dryer)\b/, ['kitchen & home', 'kitchen', 'home', 'household']],
  [/\b(bulb|torch|light|extension|socket|battery|pump)\b/, ['electricals & lighting', 'electricals', 'lighting', 'electrical']],
  [/\b(robot|toy|doll|ball|game)\b/, ['toys', 'toy']],
  [/\b(perfume|oil|spray|deodorant|decant)\b/, ['perfumes', 'oils', 'perfume']],
  [/\b(shirt|dress|trouser|jeans|shoe|skirt|jacket|t ?shirt|sweater|cap)\b/, ['clothes', 'clothing', 'fashion']],
];

// Best guess of a category for a new item: what the shop's most similar items use, else a keyword match
// against the shop's own category names. Returns '' when there is no sensible guess.
export function guessCategory(typed, products, shopCats = []) {
  const wa = words(typed);
  if (!wa.length) return '';
  const votes = {};
  for (const p of products) {
    const c = (p.category || '').trim();
    if (!c || isLabel(c)) continue;
    const wb = words(p.name);
    const hit = wa.filter((w) => wb.some((x) => near(w, x))).length;
    if (hit) votes[c] = (votes[c] || 0) + hit / wb.length;
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];
  const t = ` ${norm(typed)} `;
  const cats = shopCats.filter((c) => c && !isLabel(c));
  for (const [re, names] of KEYWORDS) {
    if (!re.test(t)) continue;
    const found = cats.find((c) => names.includes(c.trim().toLowerCase()));
    if (found) return found;
  }
  return '';
}

// a search that looks like a scanned barcode rather than a name
export const looksLikeCode = (s) => /^[0-9]{6,14}$/.test(String(s || '').trim());
