'use client';
import { Suspense, useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import PasswordField from '@/components/PasswordField';
import { post, go } from '@/lib/api';

function Form() {
  const q = useSearchParams();
  const invite = q.get('from') === 'invite';
  const [me, setMe] = useState(undefined);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' }).then((r) => r.json()).then((j) => setMe(j.user ? j : null)).catch(() => setMe(null));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (pw !== pw2) return setErr('The two passwords do not match');
    setBusy(true);
    const r = await post('/api/auth/reset', { password: pw });
    if (r.ok) return go(r.data.next || '/home');
    setBusy(false);
    if (r.data.mfa) return go('/mfa?next=/reset-password');
    setErr(r.data.error || 'Something went wrong');
  }

  if (me === undefined) return <div className="center">Loading...</div>;
  if (me === null) {
    return (
      <div className="auth">
        <div style={{ marginBottom: 8 }}><Logo height={44} /></div>
        <div className="card stack">
          <h2>This link has expired</h2>
          <p>Links work once and last one hour. Ask for a new one.</p>
          <Link className="btn primary" href="/forgot-password" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', lineHeight: '28px' }}>Get a new link</Link>
        </div>
      </div>
    );
  }
  if (me.needsMfa) { go('/mfa?next=/reset-password'); return null; }

  return (
    <div className="auth">
      <div style={{ marginBottom: 8 }}><Logo height={44} /></div>
      <h1>{invite ? 'Welcome to Uzaa' : 'Choose a new password'}</h1>
      <p className="muted">{invite ? `Choose a password for ${me.user.email}.` : `For ${me.user.email}.`}</p>
      <form onSubmit={submit} className="card">
        <PasswordField value={pw} onChange={setPw} email={me.user.email} label="New password" />
        <PasswordField value={pw2} onChange={setPw2} meter={false} label="Type it again" id="pw2" />
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Saving...' : invite ? 'Save and continue' : 'Save new password'}</button>
      </form>
    </div>
  );
}

export default function Reset() {
  return <Suspense fallback={<div className="center">Loading...</div>}><Form /></Suspense>;
}
