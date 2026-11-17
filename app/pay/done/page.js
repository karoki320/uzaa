'use client';
import { useEffect, useState } from 'react';
import Logo from '@/components/Logo';

// Paystack sends the client back here with ?reference=... after paying (or ?cancelled=1).
// We ask our server, which asks Paystack. M-Pesa can take a minute, so we keep checking for a while.
const long = (d) => new Intl.DateTimeFormat('en-KE', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

export default function PayDone() {
  const [s, setS] = useState({ state: 'checking' });
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('cancelled')) return setS({ state: 'cancelled' });
    const ref = q.get('reference') || q.get('trxref') || '';
    if (!ref) return setS({ state: 'missing' });
    let tries = 0, stop = false;
    const check = async () => {
      tries += 1;
      try {
        const r = await fetch(`/api/billing/verify?reference=${encodeURIComponent(ref)}`, { cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (j.status === 'success') return setS({ state: 'paid', until: j.paid_until, ref });
        if (j.status === 'failed' || j.status === 'abandoned') return setS({ state: j.status, msg: j.message, ref });
      } catch {}
      if (stop) return;
      if (tries < 20) setTimeout(check, 4000); else setS({ state: 'slow', ref });
    };
    check();
    return () => { stop = true; };
  }, []);

  return (
    <main className="auth">
      <div className="card" style={{ maxWidth: 460 }}>
        <Logo height={30} />
        {s.state === 'checking' && <><h2>Confirming your payment...</h2><p className="muted">This takes a few seconds. For M-Pesa, approve the request on your phone if you have not yet.</p></>}
        {s.state === 'paid' && (
          <>
            <h2>Payment received. Thank you!</h2>
            <p>Your Uzaa subscription is paid up to <b>{long(s.until)}</b>. Your account is active: sign in and start selling.</p>
            <a className="btn primary" href="/home" style={{ width: '100%', textAlign: 'center' }}>Open Uzaa</a>
            <p className="small muted">Reference {s.ref}</p>
          </>
        )}
        {(s.state === 'failed' || s.state === 'abandoned') && (
          <>
            <h2>The payment did not go through</h2>
            <p className="muted">{s.msg || 'Nothing was charged.'} You can try again with M-Pesa or a different card.</p>
            <a className="btn primary" href="/billing" style={{ width: '100%', textAlign: 'center' }}>Try again</a>
            <p className="small muted">Paid from your agreement link? Open that link again to retry.</p>
          </>
        )}
        {s.state === 'cancelled' && (
          <>
            <h2>Payment cancelled</h2>
            <p className="muted">Nothing was charged. You can pay whenever you are ready.</p>
            <a className="btn" href="/billing" style={{ width: '100%', textAlign: 'center' }}>Back to Uzaa</a>
          </>
        )}
        {s.state === 'slow' && (
          <>
            <h2>Still waiting for confirmation</h2>
            <p className="muted">If you approved the payment, it will show on your account within a few minutes. You do not need to pay again. Reference {s.ref}.</p>
            <a className="btn" href="/home" style={{ width: '100%', textAlign: 'center' }}>Open Uzaa</a>
          </>
        )}
        {s.state === 'missing' && <><h2>Nothing to confirm</h2><a className="btn" href="/home">Open Uzaa</a></>}
      </div>
    </main>
  );
}
