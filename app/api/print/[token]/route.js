import { NextResponse } from 'next/server';
import { adminClient, serverReady } from '@/lib/server';
import { hitIp } from '@/lib/ratelimit';
import { readPrint, buildJob } from '@/lib/print';
export const dynamic = 'force-dynamic';

const H = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Robots-Tag': 'noindex' };
const nope = (s = 404) => new NextResponse('{}', { status: s, headers: H });

// Fetched by the Bluetooth Print app (not a browser session), so it is protected by a signed, expiring token.
export async function GET(req, ctx) {
  if (!serverReady()) return nope(500);
  if (await hitIp('print', req, { limit: 60, window: 900 })) return nope(429);
  const { token } = await ctx.params;
  const p = readPrint(token);
  if (!p) return nope();
  const sb = adminClient();
  const { data: sale } = await sb.from('sales').select('*').eq('id', p.s).maybeSingle();
  if (!sale) return nope();
  const [{ data: items }, { data: business }, { data: branch }, { data: cashier }] = await Promise.all([
    sb.from('sale_items').select('name, qty, price, unit').eq('sale_id', sale.id),
    sb.from('businesses').select('name, currency, tax_rate, receipt_header, receipt_footer').eq('id', sale.business_id).maybeSingle(),
    sb.from('branches').select('name, address, phone').eq('id', sale.branch_id).maybeSingle(),
    sale.cashier_id ? sb.from('profiles').select('full_name').eq('id', sale.cashier_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const job = buildJob({ business, branch, sale, items: items || [], cashier: cashier?.full_name }, p.w);
  return new NextResponse(JSON.stringify(job), { headers: H });
}
