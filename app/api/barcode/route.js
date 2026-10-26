import { bad, ok, userClient, serverReady, sameOrigin, readJson } from '@/lib/server';
import { hit, LIMITS } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

// Looks a barcode up in Open Food Facts (a free, public product database) so a new product's name and size
// can be filled in for the shop. Only the barcode number is sent; nothing about the shop or its prices.
// Done here on the server: Open Food Facts asks every app to name itself, and the browser stays limited
// to talking to our own site.
const OFF = 'https://world.openfoodfacts.org/api/v2/product/';
const FIELDS = 'product_name,product_name_en,generic_name,generic_name_en,brands,quantity';
const UA = 'UzaaPOS/1.0 (point of sale for shops in Kenya)';

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function fetchOne(code) {
  const res = await fetch(`${OFF}${code}.json?fields=${FIELDS}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lookup ${res.status}`);
  const j = await res.json();
  return j?.status === 1 && j.product ? j.product : null;
}

export async function POST(req) {
  if (!sameOrigin(req)) return bad('Blocked', 403);
  const b = await readJson(req, 500);
  const code = String(b.code || '').trim();
  if (!/^\d{8,14}$/.test(code)) return ok({ found: false });   // shop-made codes are never in a public database

  const u = await userClient();
  const { data: who } = await u.auth.getUser();
  if (!who?.user) return bad('Sign in again', 401);
  if (serverReady()) {
    const limited = await hit('barcode', who.user.id, LIMITS.lookupUser);
    if (limited) return limited;
  }

  // UPC-A (12 digits) is stored there as EAN-13 with a 0 in front, and the other way round
  const tries = [code];
  if (code.length === 12) tries.push('0' + code);
  if (code.length === 13 && code.startsWith('0')) tries.push(code.slice(1));

  let p = null;
  try {
    for (const c of tries) { p = await fetchOne(c); if (p) break; }
  } catch {
    return ok({ found: false, error: 'The product database did not answer. Type the name yourself.' });
  }
  if (!p) return ok({ found: false });

  const product = clean(p.product_name_en || p.product_name || p.generic_name_en || p.generic_name);
  const brand = clean(String(p.brands || '').split(',')[0]);
  const size = clean(p.quantity);
  if (!product && !brand) return ok({ found: false });

  // "Coca-Cola Original Taste 500 ml": brand first unless the name already has it, size last
  let name = product || brand;
  if (brand && product && !product.toLowerCase().includes(brand.toLowerCase())) name = `${brand} ${product}`;
  if (size && !name.toLowerCase().includes(size.toLowerCase())) name = `${name} ${size}`;
  return ok({ found: true, name: name.slice(0, 120), brand: brand.slice(0, 60), size: size.slice(0, 40), source: 'Open Food Facts' });
}
