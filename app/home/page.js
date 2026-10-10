'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const { loading, session, me, profile } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (me?.needsMfa) router.replace('/mfa');
    else if (!profile) router.replace('/signup');
    else if (me?.mustEnrol) router.replace('/security?setup=1');
    else if (profile.role === 'super_admin') router.replace('/admin');
    else router.replace('/pos');
  }, [loading, session, me, profile, router]);
  return <div className="center">Loading...</div>;
}
