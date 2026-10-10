'use client';
import { useState } from 'react';
import Logo from '@/components/Logo';
import Link from 'next/link';
import Captcha, { captchaOn } from '@/components/Captcha';
import { post } from '@/lib/api';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const [need, setNeed] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await post('/api/auth/forgot', { email, captcha: token });
    setBusy(false);
    if (r.data.captcha) setNeed(true);
    r.ok ? setDone(r.data.message) : setErr(r.data.error || 'Something went wrong');
  }

  return (
    <div className="auth">
      <div style={{ marginBottom: 8 }}><Logo height={44} /></div>
      <h1>Forgot your password?</h1>
      <p className="muted">Enter your email and we will send you a link to choose a new one.</p>
      {done ? (
        <div className="card stack" role="status"><p>{done}</p><p className="muted small">Nothing in your inbox? Check spam, or try again in a few minutes.</p></div>
      ) : (
        <form onSubmit={submit} className="card">
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {(need || captchaOn) && need && <Captcha onToken={setToken} />}
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</button>
        </form>
      )}
      <p className="muted"><Link href="/login">Back to sign in</Link></p>
    </div>
  );
}
