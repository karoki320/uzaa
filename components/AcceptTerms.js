'use client';
import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { TERMS_DATE, TERMS_VERSION } from '@/lib/terms';

// Shown once to anyone who has not accepted the current terms. Nothing else opens until they do.
export default function AcceptTerms({ name, onDone, onSignOut }) {
  const [tick, setTick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function accept() {
    if (!tick) return setErr('Tick the box to continue');
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('accept_terms', { p_version: TERMS_VERSION });
    setBusy(false);
    // Nothing on this screen is worth locking someone out of their own till for. If it cannot be
    // recorded (the database patch is not in yet), let them through and carry on.
    if (error && error.code !== 'PGRST202' && !/could not find the function/i.test(error.message || '')) {
      return setErr('That could not be saved just now. Try again, or sign out and back in.');
    }
    onDone();
  }

  return (
    <div className="auth">
      <div className="card" style={{ maxWidth: 520 }}>
        <h2>Before you carry on{name ? `, ${name.split(' ')[0]}` : ''}</h2>
        <p className="muted">
          We have written down the terms under which Uzaa is provided: what you pay, who owns your data, and what
          each of us is responsible for. Please read them once and accept to continue.
        </p>
        <p><Link href="/terms" target="_blank">Read the terms of service</Link> (version {TERMS_VERSION}, {TERMS_DATE})</p>
        <label className="terms-tick">
          <input type="checkbox" checked={tick} onChange={(e) => { setTick(e.target.checked); setErr(''); }} />
          <span>I have read and accept the terms of service.</span>
        </label>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={accept}>
          {busy ? 'Saving...' : 'Accept and continue'}
        </button>
        <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}
