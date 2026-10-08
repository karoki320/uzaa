'use client';
import { fmtDate, num } from '@/lib/util';

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
              <span>&nbsp;&nbsp;{num(it.qty)} x {num(it.price)}</span>
              <span>{num(it.qty * it.price)}</span>
            </div>
          </div>
        ))}
        <hr />
        <div className="ln"><span>Subtotal</span><span>{num(sale.subtotal)}</span></div>
        {Number(sale.discount) > 0 && <div className="ln"><span>Discount</span><span>-{num(sale.discount)}</span></div>}
        {Number(sale.tax) > 0 && <div className="ln"><span>Tax ({num(business?.tax_rate)}%)</span><span>{num(sale.tax)}</span></div>}
        <div className="ln"><b>TOTAL {cur}</b><b>{num(sale.total)}</b></div>
        <hr />
        <div className="ln"><span>Paid by {sale.payment_method}</span><span>{num(sale.amount_paid)}</span></div>
        {change > 0 && <div className="ln"><span>Change</span><span>{num(change)}</span></div>}
        <hr />
        <div className="c" style={{ whiteSpace: 'pre-line' }}>{business?.receipt_footer}</div>
        <div className="c">Powered by Uzaa</div>
      </div>
    </div>
  );
}
