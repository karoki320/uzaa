import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { userClient, serverReady, bad } from '@/lib/server';
import { hit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TZ = 'Africa/Nairobi';
const dFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const tFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const MAX_DAYS = 366;
const MAX_SALES = 20000;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// Owners and managers download sales as an Excel file. Row level security decides what each person can read.
export async function GET(req) {
  if (!serverReady()) return bad('Server is not set up', 500);
  const u = new URL(req.url);
  const from = u.searchParams.get('from'); const to = u.searchParams.get('to');
  const branch = u.searchParams.get('branch') || '';
  if (!isDate(from) || !isDate(to) || to < from) return bad('Choose a valid From and To date');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > MAX_DAYS) return bad('Choose a range of one year or less');
  if (branch && !/^[0-9a-f-]{36}$/i.test(branch)) return bad('Bad branch');

  const sb = await userClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return bad('Sign in again', 401);
  const { data: me } = await sb.from('profiles').select('role, business_id').eq('id', auth.user.id).maybeSingle();
  if (!me || !['owner', 'manager'].includes(me.role)) return bad('Not allowed', 403);
  const l = await hit('export', auth.user.id, { limit: 20, window: 3600 }); if (l) return l;

  const start = new Date(`${from}T00:00:00+03:00`).toISOString();
  const end = new Date(new Date(`${to}T00:00:00+03:00`).getTime() + 86400000).toISOString();

  const sales = [];
  for (let off = 0; off < MAX_SALES; off += 1000) {
    let q = sb.from('sales').select('*, sale_items(name, qty, price, cost, unit, product_id)').gte('created_at', start).lt('created_at', end)
      .order('created_at').order('id').range(off, off + 999);
    if (branch) q = q.eq('branch_id', branch);
    const { data, error } = await q;
    if (error) return bad('Could not read sales', 500);
    sales.push(...data);
    if (data.length < 1000) break;
  }

  const [{ data: brs }, { data: pps }, { data: prods }] = await Promise.all([
    sb.from('branches').select('id, name'),
    sb.from('profiles').select('id, full_name'),
    sb.from('products').select('id, category').range(0, 4999),
  ]);
  const bn = Object.fromEntries((brs || []).map((b) => [b.id, b.name]));
  const pn = Object.fromEntries((pps || []).map((p) => [p.id, p.full_name]));
  const pc = Object.fromEntries((prods || []).map((p) => [p.id, p.category || '']));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Uzaa';
  const money = '#,##0.00';
  const head = (ws) => {
    const r = ws.getRow(1);
    r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B5C87' } };
    r.alignment = { vertical: 'middle' };
    r.height = 22;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };

  // Sheet 1: one row per sale
  const ws = wb.addWorksheet('Sales');
  ws.columns = [
    { header: 'Receipt no', key: 'no', width: 11 }, { header: 'Date', key: 'd', width: 12 }, { header: 'Time', key: 't', width: 8 },
    { header: 'Branch', key: 'b', width: 18 }, { header: 'Cashier', key: 'c', width: 20 }, { header: 'Paid by', key: 'pm', width: 12 },
    { header: 'Items', key: 'n', width: 8 }, { header: 'Subtotal', key: 'sub', width: 13, style: { numFmt: money } },
    { header: 'Discount', key: 'dis', width: 12, style: { numFmt: money } }, { header: 'Tax', key: 'tax', width: 12, style: { numFmt: money } },
    { header: 'Total', key: 'tot', width: 13, style: { numFmt: money } }, { header: 'Amount paid', key: 'paid', width: 13, style: { numFmt: money } },
  ];
  head(ws);
  sales.forEach((s) => {
    const dt = new Date(s.created_at);
    ws.addRow({ no: Number(s.receipt_no), d: dFmt.format(dt), t: tFmt.format(dt), b: bn[s.branch_id] || '', c: pn[s.cashier_id] || '', pm: s.payment_method || '',
      n: (s.sale_items || []).length, sub: Number(s.subtotal), dis: Number(s.discount), tax: Number(s.tax), tot: Number(s.total), paid: Number(s.amount_paid) });
  });
  const last = sales.length + 1;
  const sum = (k) => sales.reduce((t, x) => t + Number(x[k] || 0), 0);
  const tr = ws.addRow({ no: 'Total', n: { formula: `SUM(G2:G${last})`, result: sales.reduce((t, x) => t + (x.sale_items || []).length, 0) }, sub: { formula: `SUM(H2:H${last})`, result: sum('subtotal') }, dis: { formula: `SUM(I2:I${last})`, result: sum('discount') }, tax: { formula: `SUM(J2:J${last})`, result: sum('tax') }, tot: { formula: `SUM(K2:K${last})`, result: sum('total') } });
  tr.font = { bold: true };
  tr.border = { top: { style: 'thin' } };

  // Sheet 2: every item sold
  const wi = wb.addWorksheet('Items');
  wi.columns = [
    { header: 'Receipt no', key: 'no', width: 11 }, { header: 'Date', key: 'd', width: 12 }, { header: 'Time', key: 't', width: 8 },
    { header: 'Branch', key: 'b', width: 18 }, { header: 'Item', key: 'i', width: 32 }, { header: 'Category', key: 'cat', width: 16 },
    { header: 'Unit', key: 'u', width: 8 }, { header: 'Quantity', key: 'q', width: 10, style: { numFmt: '#,##0.###' } },
    { header: 'Price', key: 'p', width: 12, style: { numFmt: money } }, { header: 'Line total', key: 'lt', width: 13, style: { numFmt: money } },
    { header: 'Cost', key: 'c', width: 12, style: { numFmt: money } }, { header: 'Profit', key: 'pf', width: 13, style: { numFmt: money } },
  ];
  head(wi);
  let r = 1; let tLine = 0; let tCost = 0;
  sales.forEach((s) => {
    const dt = new Date(s.created_at);
    (s.sale_items || []).forEach((it) => {
      r += 1;
      const line = Number(it.qty) * Number(it.price); const cost = Number(it.cost) * Number(it.qty);
      tLine += line; tCost += cost;
      wi.addRow({ no: Number(s.receipt_no), d: dFmt.format(dt), t: tFmt.format(dt), b: bn[s.branch_id] || '', i: it.name, cat: pc[it.product_id] || '', u: it.unit || 'pc',
        q: Number(it.qty), p: Number(it.price), lt: { formula: `H${r}*I${r}`, result: line }, c: cost, pf: { formula: `J${r}-K${r}`, result: line - cost } });
    });
  });
  const ti = wi.addRow({ no: 'Total', lt: { formula: `SUM(J2:J${r})`, result: tLine }, c: { formula: `SUM(K2:K${r})`, result: tCost }, pf: { formula: `SUM(L2:L${r})`, result: tLine - tCost } });
  ti.font = { bold: true };
  ti.border = { top: { style: 'thin' } };

  // Sheet 3: totals by payment method
  const wp = wb.addWorksheet('By payment method');
  wp.columns = [{ header: 'Paid by', key: 'm', width: 18 }, { header: 'Sales', key: 'n', width: 10 }, { header: 'Total', key: 't', width: 14, style: { numFmt: money } }];
  head(wp);
  const by = {};
  sales.forEach((s) => { const m = s.payment_method || 'Other'; by[m] = by[m] || { n: 0, t: 0 }; by[m].n += 1; by[m].t += Number(s.total); });
  Object.entries(by).forEach(([m, v]) => wp.addRow({ m, n: v.n, t: v.t }));

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="uzaa-sales-${from}_to_${to}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
