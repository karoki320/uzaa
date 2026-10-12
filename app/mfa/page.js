'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import { useSearchParams } from 'next/navigation';
import { post, go } from '@/lib/api';

const mask = (e = '') => { const [a, d] = String(e).split('@'); return d ? `${a.slice(0, 2)}${'*'.repeat(Math.max(1, a.length - 2))}@${d}` : e; };

// Super admin: no app needed. Wait for the emailed link to be opened (on any device), then carry on.
function EmailStep({ me, safe, onUseApp }) {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const j = await (await fetch('/api/auth/me', { cache: 'no-store' })).json();
        if (!j.user) go('/login');
        else if (!j.needsMfa) go(safe === '/home' ? '/admin' : safe);
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [safe]);

  async function resend() {
    setBusy(true); setErr(''); setMsg('');
    const r = await post('/api/auth/step', { action: 'resend' });
    setBusy(false);
    if (r.data.approved) return go('/admin');
    if (r.data.signIn) return go('/login');
    r.ok ? setMsg(r.data.message) : setErr(r.data.error || 'Something went wrong');
  }
  async function out() { await post('/api/auth/logout'); go('/login'); }

  if (!me.stepPending) {
    return (
      <div className="card stack">
        <h2>Sign in with your password</h2>
        <p className="muted">For the admin account, the email link only approves a sign-in that started with your password, or the link has expired. Sign in again and we will send a fresh link.</p>
        <button className="btn primary" style={{ width: '100%' }} onClick={out}>Sign in again</button>
      </div>
    );
  }
  return (
    <div className="card stack" role="status">
      <h2>Check your email</h2>
      <p>We sent a sign-in link to <b>{mask(me.user?.email)}</b>. Open it on this device or on your phone.</p>
      <p className="muted small">Keep this page open. It continues by itself once the link is opened. The link works once and expires in an hour.</p>
      {msg && <div className="ok" role="status">{msg}</div>}
      {err && <div className="err" role="alert">{err}</div>}
      <div className="row between" style={{ marginTop: 8 }}>
        <button type="button" className="linkbtn" disabled={busy} onClick={resend}>{busy ? 'Sending...' : 'Send the link again'}</button>
        <button type="button" className="linkbtn" onClick={out}>Sign out</button>
      </div>
      {me.mfaEnrolled && <button type="button" className="linkbtn" onClick={onUseApp}>Use my authenticator app instead</button>}
    </div>
  );
}

function CodeStep({ safe, onBack }) {
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await post('/api/auth/mfa', { action: backup ? 'backup' : 'login', code });
    if (r.ok) return go(r.data.next || safe);
    setBusy(false);
    setErr(r.data.error || 'Something went wrong');
    if (r.status === 401 && !r.data.retry_after && /Sign in/.test(r.data.error || '')) go('/login');
  }
  async function out() { await post('/api/auth/logout'); go('/login'); }

  return (
    <>
      <p className="muted">{backup ? 'Enter one of your backup codes. It works once, and two-step verification will be reset so you can set it up again.' : 'Open your authenticator app and enter the 6 digit code for Uzaa.'}</p>
      <form onSubmit={submit} className="card">
        <label className="field">
          <span>{backup ? 'Backup code' : '6 digit code'}</span>
          <input className={`input ${backup ? '' : 'code'}`} inputMode={backup ? 'text' : 'numeric'} autoComplete="one-time-code" autoFocus required
            maxLength={backup ? 14 : 7} value={code} onChange={(e) => setCode(e.target.value)} placeholder={backup ? 'XXXXX-XXXXX' : '000000'} />
        </label>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Checking...' : 'Verify'}</button>
        <div className="row between" style={{ marginTop: 8 }}>
          <button type="button" className="linkbtn" onClick={() => { setBackup(!backup); setCode(''); setErr(''); }}>{backup ? 'Use my authenticator app' : 'Lost your phone? Use a backup code'}</button>
          <button type="button" className="linkbtn" onClick={out}>Sign out</button>
        </div>
        {onBack && <button type="button" className="linkbtn" style={{ marginTop: 8 }} onClick={onBack}>Use the email link instead</button>}
      </form>
    </>
  );
}

function Form() {
  const q = useSearchParams();
  const next = q.get('next');
  const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : '/home';
  const approved = q.get('approved') === '1';
  const [me, setMe] = useState(null);
  const [useApp, setUseApp] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await (await fetch('/api/auth/me', { cache: 'no-store' })).json();
      if (!j.user && !approved) return go('/login');
      if (j.user && !j.needsMfa && !approved) return go(safe);
      setMe(j);
    } catch { setMe({}); }
  }, [approved, safe]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="auth">
      <div style={{ marginBottom: 8 }}><Logo height={44} /></div>
      <h1>{approved ? 'Sign-in approved' : 'Confirm it is you'}</h1>
      {approved ? (
        <div className="card stack" role="status">
          <p>Done. Go back to the device where you entered your password. It opens the admin screen by itself within a few seconds.</p>
          <p className="muted small">Want to use this device instead? Sign in here with your password, then open the new link on this same device.</p>
          <button className="btn" style={{ width: '100%' }} onClick={() => go('/login')}>Sign in on this device</button>
        </div>
      ) : !me ? (
        <div className="center">Loading...</div>
      ) : me.mfaMode === 'email' && !useApp ? (
        <EmailStep me={me} safe={safe} onUseApp={() => setUseApp(true)} />
      ) : (
        <CodeStep safe={safe} onBack={me.mfaMode === 'email' ? () => setUseApp(false) : null} />
      )}
    </div>
  );
}

export default function Mfa() {
  return <Suspense fallback={<div className="center">Loading...</div>}><Form /></Suspense>;
}
