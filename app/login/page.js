'use client';
import { Suspense, useState } from 'react';
import Logo from '@/components/Logo';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Captcha, { captchaOn } from '@/components/Captcha';
import { post, go } from '@/lib/api';

const NOTES = {
  link: 'That link is invalid or has expired. Request a new one below.',
  reset_expired: 'That reset link has expired or was already used. Use "Forgot password" to get a new one.',
  setup: 'The server is not set up yet. Please contact Uzaa support.',
};

function Form() {
  const q = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(NOTES[q.get('e')] || '');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [token, setToken] = useState('');
  const [ck, setCk] = useState(0);
  const [unconfirmed, setUnconfirmed] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setInfo(''); setUnconfirmed(false);
    const r = await post('/api/auth/login', { email, password, captcha: token });
    if (r.ok) return go(r.data.next || '/home');
    setBusy(false);
    setErr(r.data.error || 'Could not sign in');
    if (r.data.captcha) { setNeedCaptcha(true); setToken(''); setCk((k) => k + 1); }
    if (r.data.unconfirmed) setUnconfirmed(true);
  }

  async function other(path, label) {
    if (!email.trim()) return setErr(`Enter your email first, then ${label}.`);
    setBusy(true); setErr(''); setInfo('');
    const r = await post(path, { email, captcha: token });
    setBusy(false);
    if (r.data.captcha) { setNeedCaptcha(true); setCk((k) => k + 1); }
    r.ok ? setInfo(r.data.message) : setErr(r.data.error || 'Something went wrong');
  }

  return (
    <div className="auth">
      <div style={{ marginBottom: 8 }}><Logo height={44} /></div>
      <p className="muted">Sign in to your point of sale.</p>
      <form onSubmit={submit} className="card">
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" autoComplete="current-password" required maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {needCaptcha && captchaOn && <Captcha onToken={setToken} resetKey={ck} />}
        {err && <div className="err" role="alert">{err}</div>}
        {info && <div className="note" role="status">{info}</div>}
        {unconfirmed && <p><button type="button" className="linkbtn" onClick={() => other('/api/auth/resend', 'send the link again')}>Send the confirmation link again</button></p>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        <div className="row between" style={{ marginTop: 8 }}>
          <Link href="/forgot-password">Forgot password?</Link>
          <button type="button" className="linkbtn" disabled={busy} onClick={() => other('/api/auth/magic', 'ask for a sign-in link')}>Email me a sign-in link</button>
        </div>
      </form>
      <p className="muted">
        New business? <Link href="/signup">Create your account</Link>
      </p>
    </div>
  );
}

export default function Login() {
  return <Suspense fallback={<div className="center">Loading...</div>}><Form /></Suspense>;
}
