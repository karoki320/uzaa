import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { adminClient, serverReady } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { readReceipt } from '@/lib/ereceipt';
import { hexOk, urlOk } from '@/lib/ereceipt-text';
import { waLink } from '@/lib/util';
import PrintPage from '@/components/PrintPage';
export const dynamic = 'force-dynamic';

// The customer's e-receipt. Public (the customer has no account), opened from the WhatsApp message.
// Only a valid signed link opens a sale, and only that one sale is shown.

const nairobi = (d) => new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(new Date(d));
const n2 = (n) => Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// White text on dark brand colours, near-black on light ones.
function inkOn(hex) {
  const v = hex.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  return L > 0.42 ? '#14181f' : '#ffffff';
}

async function load(token) {
  if (!serverReady()) return null;
  const id = readReceipt(token);
  if (!id) return null;
  const h = await headers();
  const ip = (h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',')[0] || 'unknown').trim().slice(0, 64);
  if (await hit('receiptview', `ip:${ip}`, { limit: 120, window: 900 })) return { busy: true };
  const sb = adminClient();
  const { data: sale } = await sb.from('sales').select('*').eq('id', id).maybeSingle();
  if (!sale) return null;
  const [{ data: items }, { data: business }, { data: branch }, { data: cashier }] = await Promise.all([
    sb.from('sale_items').select('name, qty, price, unit').eq('sale_id', sale.id),
    sb.from('businesses').select('name, currency, tax_rate, receipt_header, receipt_footer, status, ereceipt_enabled, ereceipt_whatsapp, ereceipt_color, ereceipt_logo, ereceipt_link_label, ereceipt_link_url, ereceipt_powered').eq('id', sale.business_id).maybeSingle(),
    sb.from('branches').select('name, address, phone').eq('id', sale.branch_id).maybeSingle(),
    sale.cashier_id ? sb.from('profiles').select('full_name').eq('id', sale.cashier_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!business) return null;
  return { sale, items: items || [], business, branch, cashier: cashier?.full_name?.split(' ')[0] || '' };
}

export async function generateMetadata({ params }) {
  const { token } = await params;
  const d = await load(token);
  const title = d?.sale ? `Receipt #${d.sale.receipt_no} · ${d.business.name}` : 'Receipt';
  return { title, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function EReceipt({ params }) {
  const { token } = await params;
  const d = await load(token);
  if (d?.busy) {
    return <main style={{ padding: 32, textAlign: 'center', fontFamily: 'system-ui' }}><p>Too many requests. Please try again in a few minutes.</p></main>;
  }
  if (!d) notFound();
  const { sale, items, business: b, branch, cashier } = d;
  const accent = hexOk(b.ereceipt_color) ? b.ereceipt_color : '#0b5c87';
  const ink = inkOn(accent);
  const cur = b.currency || 'KES';
  const change = Math.max(0, Number(sale.amount_paid || 0) - Number(sale.total || 0));
  const isCredit = String(sale.payment_method || '').toLowerCase() === 'credit';
  const owing = Math.max(0, Number(sale.total || 0) - Number(sale.amount_paid || 0));
  const chat = waLink(b.ereceipt_whatsapp || branch?.phone, `Hi ${b.name}, about my receipt #${sale.receipt_no}`);
  const extra = urlOk(b.ereceipt_link_url) ? b.ereceipt_link_url.trim() : '';
  const logo = /^data:image\/(png|jpeg|webp);base64,/.test(b.ereceipt_logo || '') ? b.ereceipt_logo : '';

  const css = `
    .er{min-height:100vh;background:#f3f4f6;padding:16px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#14181f}
    .er-card{max-width:460px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.08)}
    .er-top{background:${accent};color:${ink};padding:24px 20px 20px;text-align:center}
    .er-logo{width:72px;height:72px;object-fit:contain;border-radius:14px;background:#fff;padding:6px;margin:0 auto 10px;display:block}
    .er-name{font-size:21px;font-weight:800;margin:0}
    .er-sub{font-size:13px;opacity:.9;margin:4px 0 0;white-space:pre-line}
    .er-thanks{padding:18px 20px 4px;text-align:center}
    .er-thanks b{font-size:17px}
    .er-total{font-size:30px;font-weight:800;color:${accent === '#ffffff' ? '#14181f' : accent};margin:6px 0 2px}
    .er-meta{font-size:13px;color:#5b6472}
    .er-body{padding:12px 20px 4px}
    .er-row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #eceef1;font-size:14px}
    .er-row .q{color:#5b6472;font-size:12px}
    .er-sum{padding:6px 20px 14px}
    .er-sum .er-row{border:0;padding:4px 0}
    .er-grand{font-weight:800;font-size:16px;border-top:2px solid #14181f !important;padding-top:10px !important;margin-top:4px}
    .er-foot{padding:4px 20px 18px;text-align:center;font-size:13px;color:#5b6472;white-space:pre-line}
    .er-btns{display:grid;gap:10px;padding:0 20px 20px}
    .er-btn{display:block;text-align:center;padding:13px 14px;border-radius:12px;font-weight:700;font-size:15px;text-decoration:none;border:2px solid ${accent === '#ffffff' ? '#14181f' : accent};color:${accent === '#ffffff' ? '#14181f' : accent};background:#fff;cursor:pointer;font-family:inherit}
    .er-btn.main{background:#25D366;border-color:#25D366;color:#0b2e17}
    .er-pw{text-align:center;font-size:12px;color:#8a92a0;margin:14px 0 8px}
    .er-pw a{color:inherit}
    @media print{.er{background:#fff;padding:0}.er-card{box-shadow:none;border-radius:0}.er-btns,.er-pw-hide{display:none}.er-top{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  `;

  return (
    <main className="er">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="er-card">
        <header className="er-top">
          {logo ? <img className="er-logo" src={logo} alt="" /> : null}
          <h1 className="er-name">{b.name}</h1>
          {branch?.name ? <p className="er-sub">{branch.name}{branch.address ? ` · ${branch.address}` : ''}</p> : null}
          {b.receipt_header ? <p className="er-sub">{b.receipt_header}</p> : null}
        </header>

        <section className="er-thanks">
          <b>Thank you for your purchase!</b>
          <div className="er-total">{cur} {n2(sale.total)}</div>
          <div className="er-meta">Receipt #{sale.receipt_no} · {nairobi(sale.created_at)}{cashier ? ` · Served by ${cashier}` : ''}</div>
        </section>

        <section className="er-body" aria-label="Items">
          {items.map((it, i) => (
            <div className="er-row" key={i}>
              <div>{it.name}<div className="q">{n2(it.qty)}{it.unit && it.unit !== 'pc' ? ` ${it.unit}` : ''} × {n2(it.price)}</div></div>
              <div>{n2(Number(it.qty) * Number(it.price))}</div>
            </div>
          ))}
        </section>

        <section className="er-sum">
          <div className="er-row"><span>Subtotal</span><span>{n2(sale.subtotal)}</span></div>
          {Number(sale.discount) > 0 && <div className="er-row"><span>Discount</span><span>-{n2(sale.discount)}</span></div>}
          {Number(sale.tax) > 0 && <div className="er-row"><span>Tax ({n2(b.tax_rate)}%)</span><span>{n2(sale.tax)}</span></div>}
          <div className="er-row er-grand"><span>Total {cur}</span><span>{n2(sale.total)}</span></div>
          <div className="er-row"><span>Paid by {sale.payment_method}</span><span>{n2(sale.amount_paid)}</span></div>
          {change > 0 && <div className="er-row"><span>Change</span><span>{n2(change)}</span></div>}
          {isCredit && owing > 0 && <div className="er-row"><span>Balance on credit</span><span>{n2(owing)}</span></div>}
        </section>

        {b.receipt_footer ? <p className="er-foot">{b.receipt_footer}</p> : null}

        <nav className="er-btns">
          {chat ? <a className="er-btn main" href={chat} target="_blank" rel="noopener noreferrer">Chat with us on WhatsApp</a> : null}
          {extra ? <a className="er-btn" href={extra} target="_blank" rel="noopener noreferrer">{b.ereceipt_link_label?.trim() || 'Visit us'}</a> : null}
          <PrintPage className="er-btn">Download or print receipt</PrintPage>
        </nav>
      </div>
      {b.ereceipt_powered !== false && <p className="er-pw">Powered by <a href="https://uzaa.co.ke" target="_blank" rel="noopener noreferrer">Uzaa</a></p>}
    </main>
  );
}
