'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { TYPE_PRESETS } from '@/lib/util';

export default function Signup() {
  const router = useRouter();
  const { session, profile, reload, loading } = useAuth();
  const [f, setF] = useState({ full_name: '', email: '', password: '', business: '', type: 'retail' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  if (loading) return <div className="center">Loading...</div>;
  if (session && profile) {
    router.replace('/home');
    return null;
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (!session) {
        if (f.password.length < 6) throw new Error('Password must be at least 6 characters');
        const { data, error } = await supabase.auth.signUp({ email: f.email.trim(), password: f.password });
        if (error) throw error;
        if (!data.session) {
          const { error: e2 } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
          if (e2) throw new Error('Account created, but email confirmation is switched on in Supabase. Turn off "Confirm email" under Authentication > Providers > Email, then sign in.');
        }
      }
      const preset = TYPE_PRESETS[f.type];
      const { error } = await supabase.rpc('register_business', {
        p_name: f.business.trim(),
        p_type: f.type,
        p_full_name: f.full_name.trim(),
        p_item_label: preset.item_label,
        p_custom_fields: preset.custom_fields,
      });
      if (error) throw error;
      await reload();
      router.replace('/pos');
    } catch (ex) {
      setErr(ex.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="brand" style={{ fontSize: 32, marginBottom: 4 }}>Uzaa</div>
      <p className="muted">Set up your business and start selling today.</p>
      <form onSubmit={submit} className="card">
        <label className="field">
          <span>Business name</span>
          <input className="input" required value={f.business} onChange={set('business')} placeholder="e.g. Mama Njeri Stores" />
        </label>
        <label className="field">
          <span>Type of business</span>
          <select className="input" value={f.type} onChange={set('type')}>
            {Object.entries(TYPE_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Your name</span>
          <input className="input" required value={f.full_name} onChange={set('full_name')} />
        </label>
        {!session && (
          <>
            <label className="field">
              <span>Email</span>
              <input className="input" type="email" required autoComplete="email" value={f.email} onChange={set('email')} />
            </label>
            <label className="field">
              <span>Password</span>
              <input className="input" type="password" required autoComplete="new-password" value={f.password} onChange={set('password')} />
            </label>
          </>
        )}
        {err && <div className="err">{err}</div>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Setting up...' : 'Create my business'}</button>
      </form>
      <p className="muted">Already have an account? <Link href="/login">Sign in</Link></p>
    </div>
  );
}
