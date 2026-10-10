'use client';
import { useState } from 'react';
import Logo from '@/components/Logo';
import Link from 'next/link';
import PasswordField from '@/components/PasswordField';
import Captcha, { captchaOn } from '@/components/Captcha';
import { useAuth } from '@/lib/auth';
import { post, go } from '@/lib/api';
import { TYPE_PRESETS } from '@/lib/util';

export default function Signup() {
  const { session, profile, loading } = useAuth();
  const [f, setF] = useState({ full_name: '', email: '', password: '', business: '', type: 'retail' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [token, setToken] = useState('');
  const [ck, setCk] = useState(0);
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  if (loading) return <div className="center">Loading...</div>;
  if (session && profile) {
    go('/home');
    return null;
  }

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    const body = { business: f.business, type: f.type, full_name: f.full_name, captcha: token };
    if (!session) { body.email = f.email; body.password = f.password; }
    const r = await post('/api/auth/signup', body);
    if (r.ok && r.data.confirm) { setNotice(r.data.message); setBusy(false); return; }
    if (r.ok) return go(r.data.next || '/pos');
    setBusy(false);
    setErr(r.data.error || 'Something went wrong');
    if (r.data.captcha) { setNeedCaptcha(true); setToken(''); setCk((k) => k + 1); }
  }

  async function resend() {
    setBusy(true);
    const r = await post('/api/auth/resend', { email: f.email });
    setBusy(false);
    setNotice(r.ok ? r.data.message : r.data.error);
  }

  if (notice) {
    return (
      <div className="auth">
        <div style={{ marginBottom: 8 }}><Logo height={44} /></div>
        <div className="card stack" role="status">
          <h2>Check your email</h2>
          <p>{notice}</p>
          <p className="muted small">Nothing there? Look in spam, or <button type="button" className="linkbtn" disabled={busy} onClick={resend}>send it again</button>.</p>
        </div>
        <p className="muted"><Link href="/login">Back to sign in</Link></p>
      </div>
    );
  }

  return (
    <div className="auth">
      <div style={{ marginBottom: 8 }}><Logo height={44} /></div>
      <p className="muted">Set up your business and start selling today.</p>
      <form onSubmit={submit} className="card">
        <label className="field">
          <span>Business name</span>
          <input className="input" required maxLength={120} value={f.business} onChange={set('business')} placeholder="e.g. Mama Njeri Stores" />
        </label>
        <label className="field">
          <span>Type of business</span>
          <select className="input" value={f.type} onChange={set('type')}>
            {Object.entries(TYPE_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Your name</span>
          <input className="input" required maxLength={120} value={f.full_name} onChange={set('full_name')} />
        </label>
        {!session && (
          <>
            <label className="field">
              <span>Email</span>
              <input className="input" type="email" required autoComplete="email" value={f.email} onChange={set('email')} />
            </label>
            <PasswordField value={f.password} onChange={(v) => setF({ ...f, password: v })} email={f.email} />
          </>
        )}
        {needCaptcha && captchaOn && <Captcha onToken={setToken} resetKey={ck} />}
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Setting up...' : 'Create my business'}</button>
      </form>
      <p className="muted">Already have an account? <Link href="/login">Sign in</Link></p>
    </div>
  );
}
