'use client';
import { fmtDate, num, payLines } from '@/lib/util';

// the cash part of a split (what it covered)
const p0 = (sale) => payLines(sale).find((p) => p.method.toLowerCase() === 'cash')?.amount || 0;

export default function Receipt({ business, branch, sale, items, cashier }) {
  const cur = business?.currency || 'KES';
  const change = Math.max(0, Number(sale.amount_paid || 0) - Number(sale.total || 0));
  return (
    <div className="receipt-print">
      <div className="receipt">
        <div className="c"><b>{business?.name}</b></div>
        {branch && <div className="c">{branch.name}</div>}
        {branch?.address ? <div className="c">{branch.address}</div> : null}
        {branch?.phone ? <div className="c">Tel {branch.phone}</div> : null}
        {business?.receipt_header ? <div className="c" style={{ whiteSpace: 'pre-line' }}>{business.receipt_header}</div> : null}
        <hr />
        <div className="ln"><span>Receipt #{sale.receipt_no}</span></div>
        <div>{fmtDate(sale.created_at)}</div>
        {cashier ? <div>Served by {cashier}</div> : null}
        <hr />
        {items.map((it, i) => (
          <div key={i}>
            <div>{it.name}</div>
            <div className="ln">
              <span>&nbsp;&nbsp;{num(it.qty)}{it.unit && it.unit !== 'pc' ? ` ${it.unit}` : ''} x {num(it.price)}</span>
              <span>{Number(it.price) === 0 ? 'FREE' : num(it.qty * it.price)}</span>
            </div>
          </div>
        ))}
        <hr />
        <div className="ln"><span>Subtotal</span><span>{num(sale.subtotal)}</span></div>
        {Number(sale.discount) - Number(sale.points_value || 0) > 0.004 && <div className="ln"><span>Discount</span><span>-{num(Number(sale.discount) - Number(sale.points_value || 0))}</span></div>}
        {Number(sale.points_value) > 0 && <div className="ln"><span>Points used ({num(sale.points_used)})</span><span>-{num(sale.points_value)}</span></div>}
        {Number(sale.tax) > 0 && <div className="ln"><span>Tax ({num(business?.tax_rate)}%)</span><span>{num(sale.tax)}</span></div>}
        <div className="ln"><b>TOTAL {cur}</b><b>{num(sale.total)}</b></div>
        {Number(sale.points_earned) > 0 && <div className="ln"><span>Points earned</span><span>{num(sale.points_earned)}</span></div>}
        <hr />
        {sale.payments?.length
          ? <>{payLines(sale).map((p) => <div className="ln" key={p.method}><span>Paid by {p.method}</span><span>{num(p.amount)}</span></div>)}
              {change > 0 && <div className="ln"><span>Cash given</span><span>{num(p0(sale) + change)}</span></div>}</>
          : String(sale.payment_method).toLowerCase() === 'credit'
            ? <><div className="ln"><span>{business?.credit_style === 'part' ? 'Paid now' : 'Deposit'}{sale.deposit_method ? ` (${sale.deposit_method})` : ''}</span><span>{num(sale.amount_paid)}</span></div>
                <div className="ln"><b>Balance</b><b>{num(Math.max(0, Number(sale.total) - Number(sale.amount_paid || 0)))}</b></div></>
            : <div className="ln"><span>Paid by {sale.payment_method}</span><span>{num(sale.amount_paid)}</span></div>}
        {change > 0 && <div className="ln"><span>Change</span><span>{num(change)}</span></div>}
        <hr />
        <div className="c" style={{ whiteSpace: 'pre-line' }}>{business?.receipt_footer}</div>
        <div className="c">Powered by Uzaa</div>
      </div>
    </div>
  );
}
