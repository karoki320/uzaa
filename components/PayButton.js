'use client';
import { useState } from 'react';
import { post, go } from '@/lib/api';

// Opens a Paystack checkout (M-Pesa or card). Paystack brings the person back to /pay/done.
export default function PayButton({ endpoint, label, cardOption = true, defaultSave = false, className = 'btn primary' }) {
  const [save, setSave] = useState(defaultSave);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function pay() {
    setBusy(true); setErr('');
    const r = await post(endpoint, { action: 'pay', save_card: save });
    if (r.ok && r.data.url) return go(r.data.url);
    setBusy(false); setErr(r.data.error || 'Could not start the payment. Try again.');
  }
  return (
    <div className="pay-box">
      <button className={className} onClick={pay} disabled={busy} style={{ width: '100%' }}>{busy ? 'Opening Paystack...' : label}</button>
      {cardOption && (
        <label className="small row" style={{ gap: 8, marginTop: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} style={{ marginTop: 3 }} />
          <span>If I pay by card, save it and renew automatically on the due date. You can stop this any time under Billing. M-Pesa payments are never charged automatically.</span>
        </label>
      )}
      <p className="small muted" style={{ margin: '8px 0 0' }}>Secure payment by Paystack: M-Pesa or card.</p>
      {err && <p className="small warn" role="alert">{err}</p>}
    </div>
  );
}
