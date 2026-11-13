'use client';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { money, fmtDate, waLink } from '@/lib/util';
import { ereceiptMessage } from '@/lib/ereceipt-text';
import Modal from './Modal';

// Send the customer their e-receipt on WhatsApp. WhatsApp opens on this phone with the customer's
// chat and the thank-you message already typed: the cashier only presses Send.
// The link is fetched as soon as this opens, so the button is a real link and works on the first tap.
export default function EReceiptSend({ business, sale, phone: phone0 = '', name: name0 = '', onClose }) {
  const [phone, setPhone] = useState(phone0);
  const [name, setName] = useState(name0);
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [items, setItems] = useState(null);   // the breakdown of what was bought, for the message

  useEffect(() => {
    let dead = false;
    post('/api/ereceipt/link', { sale_id: sale.id }).then((r) => {
      if (dead) return;
      r.ok ? setLink(r.data.url) : setErr(r.data.error || 'Could not prepare the e-receipt link');
    });
    supabase.from('sale_items').select('name,qty,price,unit').eq('sale_id', sale.id)
      .then(({ data }) => { if (!dead) setItems(data || []); }, () => { if (!dead) setItems([]); });
    return () => { dead = true; };
  }, [sale.id]);

  const msg = link && items ? ereceiptMessage(business, {
    customer: name, receipt: sale.receipt_no, total: money(sale.total, business.currency),
    date: sale.created_at ? fmtDate(sale.created_at) : '', link, items,
  }) : '';
  const wa = msg ? waLink(phone, msg) : '';
  const typed = phone.replace(/\D/g, '').length >= 9;

  async function copy() {
    try { await navigator.clipboard.writeText(msg); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setErr('Could not copy on this phone'); }
  }

  return (
    <Modal title="Send e-receipt" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Receipt #{sale.receipt_no}, {money(sale.total, business.currency)}. WhatsApp opens with the message ready. Just press Send.
      </p>
      <label className="field"><span>Customer's WhatsApp number</span>
        <input className="input" inputMode="tel" autoComplete="off" placeholder="0722 000 111" value={phone} autoFocus={!phone0}
          onChange={(e) => { setPhone(e.target.value); setSent(false); }} />
      </label>
      <label className="field"><span>Customer's name (optional)</span>
        <input className="input" maxLength={60} placeholder="e.g. Wanjiku" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {msg && (
        <div className="tint small" style={{ whiteSpace: 'pre-line', marginBottom: 12, wordBreak: 'break-word' }} aria-label="Message preview">{msg}</div>
      )}
      {err && <div className="err" role="alert">{err}</div>}
      {typed && !wa && link && <div className="err" role="alert">Check the number. Use the format 0722 000 111 or +254 722 000 111.</div>}
      {wa
        ? <a className="btn primary" href={wa} target="_blank" rel="noopener noreferrer" onClick={() => setSent(true)}
            style={{ display: 'block', textAlign: 'center', textDecoration: 'none', lineHeight: '28px', background: '#25D366', borderColor: '#25D366', color: '#0b2e17' }}>
            {sent ? 'Open WhatsApp again' : 'Send on WhatsApp'}
          </a>
        : <button className="btn primary" style={{ width: '100%' }} disabled>{!link && !err ? 'Preparing...' : 'Send on WhatsApp'}</button>}
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn grow" disabled={!msg} onClick={copy}>{copied ? 'Copied' : 'Copy message'}</button>
        {link && <a className="btn grow" href={link} target="_blank" rel="noopener noreferrer" style={{ textAlign: 'center', textDecoration: 'none' }}>View e-receipt</a>}
      </div>
      {sent && <p className="ok small" role="status">Sent from WhatsApp? You can close this.</p>}
    </Modal>
  );
}
