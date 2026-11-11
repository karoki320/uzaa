'use client';
import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { num, waLink } from '@/lib/util';
import Modal from './Modal';

// Turns the low-stock list into an order for the supplier on WhatsApp. Quantities start at enough to
// reach twice the warning level and can be changed or set to 0 to leave an item out.
export default function Reorder({ business, items, isOwner, onClose, onSaved }) {
  const [qty, setQty] = useState(() => Object.fromEntries(items.map((p) => [p.id, String(Math.max(1, Math.ceil(Number(p.low_stock_level || 0) * 2 - Math.max(0, p.qty))))])));
  const [name, setName] = useState(business.supplier_name || '');
  const [phone, setPhone] = useState(business.supplier_whatsapp || '');
  const [remember, setRemember] = useState(isOwner && !business.supplier_whatsapp);
  const [err, setErr] = useState('');

  const lines = items.filter((p) => Number(qty[p.id]) > 0);
  const msg = useMemo(() => [
    `Hello${name.trim() ? ` ${name.trim()}` : ''}, this is ${business.name}.`,
    'Please send us:',
    ...lines.map((p) => `- ${num(Number(qty[p.id]))}${p.unit && p.unit !== 'pc' ? ` ${p.unit}` : ''} x ${p.name}`),
    'Let us know the total and when it can be delivered. Thank you.',
  ].join('\n'), [lines, qty, name, business.name]);
  // no number (or a wrong one): WhatsApp opens and lets them pick the chat
  const wa = waLink(phone, msg) || `https://wa.me/?text=${encodeURIComponent(msg)}`;

  async function sent() {
    if (!remember || !isOwner) return;
    const { error } = await supabase.from('businesses').update({ supplier_name: name.trim().slice(0, 80), supplier_whatsapp: phone.trim().slice(0, 20) }).eq('id', business.id);
    if (error) setErr(/column/i.test(error.message) ? 'Run security-patch-14.sql to remember the supplier.' : error.message);
    else onSaved?.();
  }

  return (
    <Modal title="Reorder on WhatsApp" onClose={onClose}>
      <div className="row">
        <label className="field grow"><span>Supplier</span><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mombasa Perfume Wholesalers" /></label>
        <label className="field grow"><span>Their WhatsApp</span><input className="input" inputMode="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} placeholder="0722 000 111" /></label>
      </div>
      {isOwner && (
        <label className="row" style={{ marginBottom: 12 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember this supplier</label>
      )}
      <div className="card" style={{ padding: '8px 14px' }}>
        {items.map((p) => (
          <div className="lrow" key={p.id}>
            <span className="grow2"><b style={{ fontSize: 14 }}>{p.name}</b><span>{num(p.qty)} left · warn at {num(p.low_stock_level)}</span></span>
            <input className="input" inputMode="decimal" value={qty[p.id]} onChange={(e) => setQty({ ...qty, [p.id]: e.target.value })} aria-label={`Order quantity for ${p.name}`} style={{ width: 76, minHeight: 44, textAlign: 'center' }} />
          </div>
        ))}
      </div>
      <p className="small muted">{lines.length} item{lines.length === 1 ? '' : 's'} in the order. Set a quantity to 0 to leave it out.</p>
      {phone.trim() && !waLink(phone) && <div className="err">Check the number, e.g. 0722 000 111.</div>}
      {err && <div className="err">{err}</div>}
      <a className="btn primary" href={lines.length ? wa : undefined} target="_blank" rel="noopener noreferrer" onClick={sent} aria-disabled={!lines.length}
        style={{ display: 'block', textAlign: 'center', textDecoration: 'none', lineHeight: '28px', background: '#25D366', color: '#0b2e17', opacity: lines.length ? 1 : 0.5 }}>
        Send order on WhatsApp
      </a>
    </Modal>
  );
}
