'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setErr(error.message);
    router.replace('/');
  }

  return (
    <div className="auth">
      <div className="brand" style={{ fontSize: 32, marginBottom: 4 }}>Uzaa</div>
      <p className="muted">Sign in to your point of sale.</p>
      <form onSubmit={submit} className="card">
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <div className="err">{err}</div>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
      </form>
      <p className="muted">
        New business? <Link href="/signup">Create your account</Link>
      </p>
    </div>
  );
}
