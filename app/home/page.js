'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const { loading, session, me, profile, reload, signOut } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (me?.needsMfa) router.replace('/mfa');
    else if (me?.profileError) return;                 // a failed read is not "no business": never send them to signup
    else if (!profile) router.replace('/signup');
    else if (profile.role === 'super_admin') router.replace('/admin');
    else if (profile.role === 'sales') router.replace('/agent');
    else router.replace('/pos');
  }, [loading, session, me, profile, router]);

  if (!loading && session && me?.profileError) {
    return (
      <div className="auth">
        <div className="card">
          <h2>We could not load your business</h2>
          <p className="muted">You are signed in and your data is safe, but Uzaa could not read your business just now. Try again in a moment. If it keeps happening, send this to Uzaa support: {me.profileError}</p>
          <button className="btn primary" style={{ width: '100%' }} onClick={() => reload()}>Try again</button>
          <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }
  return <div className="center">Loading...</div>;
}
