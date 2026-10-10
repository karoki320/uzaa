'use client';
import { Suspense, useState } from 'react';
import Logo from '@/components/Logo';
import { useSearchParams } from 'next/navigation';
import { post, go } from '@/lib/api';

function Form() {
  const q = useSearchParams();
  const next = q.get('next');
  const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : '/home';
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
    <div className="auth">
      <div style={{ marginBottom: 8 }}><Logo height={44} /></div>
      <h1>Two-step verification</h1>
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
      </form>
    </div>
  );
}

export default function Mfa() {
  return <Suspense fallback={<div className="center">Loading...</div>}><Form /></Suspense>;
}
