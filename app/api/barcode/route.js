import { bad, ok, userClient, adminClient, serverReady, sameOrigin, readJson } from '@/lib/server';
import { hit, LIMITS } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

// A barcode holds only a number. This finds the product's name (and size) for a shop adding a new item.
// It asks, in order, and stops at the first answer:
//   1. Other Uzaa shops: a name another business already saved for this barcode. Best for local Kenyan
//      products, which no global database knows well, and it grows as more shops use Uzaa.
//      Only the name, unit and category are shared, never prices, stock or which shop it came from.
//   2. Open Food Facts, Open Products Facts and Open Beauty Facts: free public databases
//      (food and drinks; household goods; toiletries and cosmetics).
//   3. Paid databases, only when their key is set in Vercel: GO_UPC_KEY (go-upc.com) and/or
//      UPCITEMDB_KEY (upcitemdb.com). Without a key UPCitemdb's small free allowance is used.
// Only the barcode number leaves our servers.

const UA = 'UzaaPOS/1.0 (point of sale for shops in Kenya)';
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const keysFor = (code) => {
  const k = [code];
  if (code.length === 12) k.push('0' + code);
  if (code.length === 13 && code.startsWith('0')) k.push(code.slice(1));
  return k;
};

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(6000), cache: 'no-store' });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// "Coca-Cola Original Taste 500 ml": brand first unless the name already has it, size last
function compose(product, brand, size) {
  product = clean(product); brand = clean(brand); size = clean(size);
  let name = product || brand;
  if (!name) return '';
  if (brand && product && !product.toLowerCase().includes(brand.toLowerCase())) name = `${brand} ${product}`;
  if (size && !name.toLowerCase().includes(size.toLowerCase())) name = `${name} ${size}`;
  return name.slice(0, 120);
}

// 1. other shops on Uzaa: the name most businesses agree on
async function fromUzaa(keys, myBusiness) {
  const sb = adminClient();
  const { data } = await sb.from('products').select('name,unit,category,business_id').in('barcode', keys).neq('business_id', myBusiness).limit(50);
  if (!data?.length) return null;
  const votes = new Map();
  for (const r of data) {
    const name = clean(r.name);
    if (!name) continue;
    const k = name.toLowerCase();
    const v = votes.get(k) || { name, unit: r.unit, category: clean(r.category), shops: new Set() };
    v.shops.add(r.business_id);
    votes.set(k, v);
  }
  const best = [...votes.values()].sort((a, b) => b.shops.size - a.shops.size)[0];
  if (!best) return null;
  return { name: best.name.slice(0, 120), unit: best.unit || '', category: best.category.slice(0, 60), source: best.shops.size > 1 ? `${best.shops.size} other Uzaa shops` : 'another Uzaa shop' };
}

// 2. the Open ... Facts family (same API on each site)
const OPEN = [
  ['https://world.openfoodfacts.org', 'Open Food Facts'],
  ['https://world.openproductsfacts.org', 'Open Products Facts'],
  ['https://world.openbeautyfacts.org', 'Open Beauty Facts'],
];
async function fromOpen(keys) {
  const fields = 'product_name,product_name_en,generic_name,generic_name_en,brands,quantity';
  const tries = OPEN.flatMap(([host, label]) => keys.map((k) => [`${host}/api/v2/product/${k}.json?fields=${fields}`, label]));
  const found = await Promise.all(tries.map(([url, label]) => getJson(url).then((j) => {
    const p = j?.status === 1 ? j.product : null;
    if (!p) return null;
    const name = compose(p.product_name_en || p.product_name || p.generic_name_en || p.generic_name, String(p.brands || '').split(',')[0], p.quantity);
    return name ? { name, source: label } : null;
  }).catch(() => null)));
  return found.find(Boolean) || null;
}

// 3a. Go-UPC (paid, large international database)
async function fromGoUpc(code) {
  const key = process.env.GO_UPC_KEY;
  if (!key) return null;
  const j = await getJson(`https://go-upc.com/api/v1/code/${code}`, { Authorization: `Bearer ${key}` }).catch(() => null);
  const p = j?.product;
  const name = p ? compose(p.name, p.brand, '') : '';
  return name ? { name, source: 'Go-UPC' } : null;
}

// 3b. UPCitemdb (paid key, or its small free allowance)
async function fromUpcItemDb(code) {
  const key = process.env.UPCITEMDB_KEY;
  const url = key ? `https://api.upcitemdb.com/prod/v1/lookup?upc=${code}` : `https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`;
  const j = await getJson(url, key ? { user_key: key, key_type: '3scale' } : {}).catch(() => null);
  const it = j?.items?.[0];
  const name = it ? compose(it.title, it.brand, '') : '';
  return name ? { name, source: 'UPCitemdb' } : null;
}

export async function POST(req) {
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req, 500);
  const code = String(b.code || '').trim();
  if (!/^\d{8,14}$/.test(code)) return ok({ found: false });   // shop-made codes are in no shared database

  const u = await userClient();
  const { data: who } = await u.auth.getUser();
  if (!who?.user) return bad('Sign in again', 401);
  if (!serverReady()) return ok({ found: false });
  const limited = await hit('barcode', who.user.id, LIMITS.lookupUser);
  if (limited) return limited;

  const sb = adminClient();
  const { data: me } = await sb.from('profiles').select('business_id,active').eq('id', who.user.id).maybeSingle();
  if (!me?.active || !me.business_id) return bad('Not allowed', 403);

  const keys = keysFor(code);
  try {
    const local = await fromUzaa(keys, me.business_id);
    if (local) return ok({ found: true, ...local });

    // the outside databases are asked together, and the answer taken in this order of trust
    const [open, goupc, upcdb] = await Promise.all([fromOpen(keys), fromGoUpc(code), fromUpcItemDb(code)]);
    const r = open || goupc || upcdb;
    if (r) return ok({ found: true, ...r });
  } catch {
    return ok({ found: false, error: 'The product databases did not answer. Type the name yourself.' });
  }
  return ok({ found: false });
}
