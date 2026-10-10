'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import PasswordField from '@/components/PasswordField';
import { useAuth } from '@/lib/auth';
import { post } from '@/lib/api';

function Msg({ m }) {
  if (!m) return null;
  return m.err ? <div className="err" role="alert">{m.err}</div> : <div className="note" role="status">{m.ok}</div>;
}

function PasswordCard({ email }) {
  const [step, setStep] = useState(0);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true); setM(null);
    const r = await post('/api/auth/password', { action: 'send' });
    setBusy(false);
    r.ok ? (setStep(1), setM({ ok: r.data.message })) : setM({ err: r.data.error });
  }
  async function save(e) {
    e.preventDefault(); setBusy(true); setM(null);
    const r = await post('/api/auth/password', { action: 'change', code, password: pw });
    setBusy(false);
    if (r.ok) { setStep(0); setCode(''); setPw(''); setM({ ok: r.data.message }); } else setM({ err: r.data.error });
  }
  return (
    <div className="card">
      <h2>Password</h2>
      {step === 0 ? (
        <>
          <p className="muted">To keep your account safe we email you a 6 digit code before changing your password.</p>
          <button className="btn" onClick={send} disabled={busy}>{busy ? 'Sending...' : 'Email me a code'}</button>
        </>
      ) : (
        <form onSubmit={save}>
          <label className="field"><span>6 digit code from your email</span>
            <input className="input code" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <PasswordField value={pw} onChange={setPw} email={email} label="New password" />
          <button className="btn primary" disabled={busy}>{busy ? 'Saving...' : 'Change password'}</button>{' '}
          <button type="button" className="linkbtn" onClick={() => { setStep(0); setM(null); }}>Cancel</button>
        </form>
      )}
      <Msg m={m} />
    </div>
  );
}

function EmailCard({ email }) {
  const [v, setV] = useState('');
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault(); setBusy(true); setM(null);
    const r = await post('/api/auth/email', { email: v });
    setBusy(false);
    r.ok ? (setM({ ok: r.data.message }), setV('')) : setM({ err: r.data.error });
  }
  return (
    <div className="card">
      <h2>Email</h2>
      <p className="muted">Signed in as <b>{email}</b>. If you change it, we ask both the old and the new address to confirm.</p>
      <form onSubmit={save}>
        <label className="field"><span>New email</span><input className="input" type="email" required value={v} onChange={(e) => setV(e.target.value)} /></label>
        <button className="btn" disabled={busy}>{busy ? 'Sending...' : 'Change email'}</button>
      </form>
      <Msg m={m} />
    </div>
  );
}

function Codes({ list, onDone }) {
  return (
    <div className="stack">
      <div className="note"><b>Save these backup codes now.</b> They are shown only once. Each works one time if you lose your phone. Keep them somewhere safe, away from your phone.</div>
      <div className="codes">{list.map((c) => <span key={c}>{c}</span>)}</div>
      <div className="row">
        <button className="btn" onClick={() => navigator.clipboard?.writeText(list.join('\n'))}>Copy codes</button>
        <button className="btn primary" onClick={onDone}>I have saved them</button>
      </div>
    </div>
  );
}

function MfaCard({ role, setup, reload }) {
  const [st, setSt] = useState(null);
  const [en, setEn] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('');   // '', 'disable', 'regen'

  const refresh = async () => { const r = await post('/api/auth/mfa', { action: 'status' }); if (r.ok) setSt(r.data); };
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (setup && st && !st.enrolled && !en) start(); }, [st]); // eslint-disable-line

  async function start() {
    setBusy(true); setM(null);
    const r = await post('/api/auth/mfa', { action: 'enroll' });
    setBusy(false);
    r.ok ? setEn(r.data) : setM({ err: r.data.error });
  }
  async function confirm(e) {
    e.preventDefault(); setBusy(true); setM(null);
    const r = await post('/api/auth/mfa', { action: 'confirm', factorId: en.factorId, code });
    setBusy(false);
    if (r.ok) { setCodes(r.data.backupCodes); setEn(null); setCode(''); } else setM({ err: r.data.error });
  }
  async function act(e) {
    e.preventDefault(); setBusy(true); setM(null);
    const r = await post('/api/auth/mfa', { action: mode, code });
    setBusy(false);
    if (!r.ok) return setM({ err: r.data.error });
    setCode(''); setMode('');
    if (r.data.backupCodes) setCodes(r.data.backupCodes); else { setM({ ok: 'Two-step verification is off.' }); }
    refresh();
  }
  const done = async () => { setCodes(null); await refresh(); await reload(); };

  return (
    <div className="card">
      <h2>Two-step verification</h2>
      {role === 'super_admin' && <p className="note">Required for your account. Nothing else opens until it is set up.</p>}
      {codes ? <Codes list={codes} onDone={done} /> : en ? (
        <form onSubmit={confirm} className="stack">
          <p>1. Install an authenticator app such as Google Authenticator, Microsoft Authenticator or Authy.</p>
          <p>2. Scan this code with the app.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="qr" src={en.qr} alt="QR code to scan with your authenticator app" />
          <p className="small muted">Cannot scan? Enter this key in the app instead: <b style={{ wordBreak: 'break-all' }}>{en.secret}</b></p>
          <label className="field"><span>3. Enter the 6 digit code the app shows</span>
            <input className="input code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button className="btn primary" disabled={busy}>{busy ? 'Checking...' : 'Turn on'}</button>
        </form>
      ) : st?.enrolled ? (
        <div className="stack">
          <p>Status: <span className="badge">On</span> &nbsp;<span className="muted small">{st.backupLeft} backup code{st.backupLeft === 1 ? '' : 's'} left</span></p>
          {mode ? (
            <form onSubmit={act}>
              <label className="field"><span>{mode === 'disable' ? 'Enter your current 6 digit code to turn it off' : 'Enter your current 6 digit code to make new backup codes'}</span>
                <input className="input code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
              <button className={`btn ${mode === 'disable' ? 'danger' : 'primary'}`} disabled={busy}>{busy ? 'Checking...' : mode === 'disable' ? 'Turn off' : 'Make new codes'}</button>{' '}
              <button type="button" className="linkbtn" onClick={() => { setMode(''); setCode(''); setM(null); }}>Cancel</button>
            </form>
          ) : (
            <div className="row">
              <button className="btn" onClick={() => { setMode('regen'); setM(null); }}>New backup codes</button>
              {role !== 'super_admin' && <button className="btn danger" onClick={() => { setMode('disable'); setM(null); }}>Turn off</button>}
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="muted">Add a second step at sign-in: a code from your phone. Even if someone learns your password, they cannot get in without it.</p>
          <button className="btn primary" onClick={start} disabled={busy || !st}>{busy ? 'Starting...' : 'Set up'}</button>
        </>
      )}
      <Msg m={m} />
    </div>
  );
}

function Body() {
  const { me, profile, reload, signOut } = useAuth();
  const q = useSearchParams();
  if (!me) return null;
  return (
    <>
      <h1>Security</h1>
      {q.get('changed') && <div className="note" role="status">Your email was updated.</div>}
      {q.get('reset') && <div className="note" role="status">Two-step verification was reset. Set it up again below.</div>}
      <div className="cols two">
        <div>
          <MfaCard role={profile?.role} setup={q.get('setup') === '1'} reload={reload} />
        </div>
        <div>
          <PasswordCard email={me.user.email} />
          <EmailCard email={me.user.email} />
          <div className="card">
            <h2>Sign out</h2>
            <p className="muted">Sign out of this device.</p>
            <button className="btn" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Security() {
  return <Suspense fallback={<div className="center">Loading...</div>}><Body /></Suspense>;
}
