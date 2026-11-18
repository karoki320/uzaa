'use client';
import { useState } from 'react';
import { PLANS, TRIAL_DAYS } from '@/lib/plans';
import Logo from '@/components/Logo';
import Link from 'next/link';
import PasswordField from '@/components/PasswordField';
import Captcha, { captchaOn } from '@/components/Captcha';
import { useAuth } from '@/lib/auth';
import { post, go } from '@/lib/api';
import { TYPE_PRESETS } from '@/lib/util';

export default function Signup() {
  const { session, profile, me, loading } = useAuth();
  const [f, setF] = useState({ full_name: '', email: '', password: '', business: '', type: 'retail', ereceipt: false, ereceipt_whatsapp: '', start: 'trial', period: 'quarter' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [token, setToken] = useState('');
  const [ck, setCk] = useState(0);
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [terms, setTerms] = useState(false);
  const [exists, setExists] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  if (loading) return <div className="center">Loading...</div>;
  // Signed in already with a business (or the business just failed to load): never offer a second one.
  if (session && (profile || me?.profileError || me?.needsMfa)) {
    go('/home');
    return null;
  }

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    if (!terms) { setBusy(false); return setErr('Tick the box to accept the terms before you continue'); }
    const body = { business: f.business, type: f.type, full_name: f.full_name, captcha: token, terms: true, ereceipt: !!f.ereceipt, ereceipt_whatsapp: f.ereceipt ? f.ereceipt_whatsapp : '', start: f.start, period: f.period };
    if (!session) { body.email = f.email; body.password = f.password; }
    const r = await post('/api/auth/signup', body);
    if (r.ok && r.data.confirm) { setNotice(r.data.message); setBusy(false); return; }
    if (r.ok) return go(r.data.next || '/pos');
    setBusy(false);
    setErr(r.data.error || 'Something went wrong');
    if (r.data.captcha) { setNeedCaptcha(true); setToken(''); setCk((k) => k + 1); }
    setExists(!!r.data.signIn);
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
            <PasswordField value={f.password} onChange={(v) => setF({ ...f, password: v })} email={f.email} confirm />
          </>
        )}
        <label className="terms-tick">
          <input type="checkbox" checked={f.ereceipt} onChange={(e) => setF({ ...f, ereceipt: e.target.checked })} />
          <span>Send my customers e-receipts on WhatsApp (free). You can add your logo and colours later in Settings.</span>
        </label>
        {f.ereceipt && (
          <label className="field">
            <span>Your shop's WhatsApp number</span>
            <input className="input" inputMode="tel" required maxLength={20} placeholder="0722 000 111" value={f.ereceipt_whatsapp} onChange={set('ereceipt_whatsapp')} />
          </label>
        )}
        <fieldset className="field" style={{ border: 0, padding: 0, margin: '4px 0 10px' }}>
          <span>{PLANS.standard.name}: how do you want to start?</span>
          <label className="terms-tick">
            <input type="radio" name="start" checked={f.start === 'trial'} onChange={() => setF({ ...f, start: 'trial' })} />
            <span><b>Free for {TRIAL_DAYS} days</b>, then pay. No payment today.</span>
          </label>
          <label className="terms-tick">
            <input type="radio" name="start" checked={f.start === 'pay'} onChange={() => setF({ ...f, start: 'pay' })} />
            <span><b>Pay now</b> with M-Pesa or card and start selling straight away.</span>
          </label>
          <label className="field" style={{ marginTop: 6 }}>
            <span>{f.start === 'pay' ? 'How often you pay' : 'After the trial, pay'}</span>
            <select className="input" value={f.period} onChange={set('period')}>
              <option value="week">Weekly: KES {PLANS.standard.prices.week}</option>
              <option value="month">Monthly: KES {PLANS.standard.prices.month}</option>
              <option value="quarter">Every 3 months: KES {PLANS.standard.prices.quarter.toLocaleString()} (best value)</option>
            </select>
          </label>
        </fieldset>
        {needCaptcha && captchaOn && <Captcha onToken={setToken} resetKey={ck} />}
        <label className="terms-tick">
          <input type="checkbox" checked={terms} onChange={(e) => { setTerms(e.target.checked); setErr(''); }} />
          <span>I have read and accept the <Link href="/terms" target="_blank">terms of service</Link>.</span>
        </label>
        {err && <div className="err" role="alert">{err}</div>}
        {exists && (
          <Link className="btn primary" href={`/login?email=${encodeURIComponent(f.email)}`} style={{ display: 'block', textAlign: 'center', textDecoration: 'none', lineHeight: '28px', marginBottom: 8 }}>
            Sign in to my business
          </Link>
        )}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Setting up...' : 'Create my business'}</button>
      </form>
      <p className="muted">Already have an account? <Link href="/login">Sign in</Link></p>
    </div>
  );
}
