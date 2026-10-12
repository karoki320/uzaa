'use client';
import { useEffect, useState } from 'react';
import { alertState, turnOnAlerts, turnOffAlerts, alertsPossible } from '@/lib/alerts';
import { useInstall } from '@/lib/pwa';

// "Alerts on this phone" is separate from "what to tell me about": the owner may have two phones.
export default function AlertSettings() {
  const [state, setState] = useState('off');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const { installed } = useInstall();
  const ios = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => { alertState().then(setState); }, []);

  async function toggle() {
    setBusy(true); setErr(''); setMsg('');
    const r = state === 'on' ? await turnOffAlerts() : await turnOnAlerts();
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setState(await alertState());
    setMsg(state === 'on' ? 'Alerts are off on this phone.' : 'Alerts are on. A test one has just been sent.');
  }

  if (!alertsPossible()) {
    return <p className="muted small" style={{ margin: 0 }}>
      This browser cannot show alerts.{ios && !installed ? ' On iPhone, install Uzaa to the home screen first, then open it from there.' : ''}
    </p>;
  }

  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>
        {state === 'on'
          ? 'This phone will buzz when there is something to tell you.'
          : 'Turn alerts on for this phone. Each phone you use needs its own permission.'}
      </p>
      {state === 'blocked' && (
        <div className="note small">
          Your browser is blocking alerts for Uzaa. Open the padlock beside the address, allow notifications, then try again.
        </div>
      )}
      {ios && !installed && (
        <div className="note small">On iPhone, alerts only work once Uzaa is installed to the home screen and opened from there.</div>
      )}
      <button type="button" className={`btn ${state === 'on' ? '' : 'primary'}`} disabled={busy || state === 'blocked'} onClick={toggle}>
        {busy ? 'Working...' : state === 'on' ? 'Turn alerts off on this phone' : 'Turn alerts on for this phone'}
      </button>
      {err && <div className="err" role="alert">{err}</div>}
      {msg && <div className="ok" role="status">{msg}</div>}
    </>
  );
}
