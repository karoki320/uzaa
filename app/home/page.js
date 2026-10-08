'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const { loading, session, profile } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (!profile) router.replace('/signup');
    else if (profile.role === 'super_admin') router.replace('/admin');
    else router.replace('/pos');
  }, [loading, session, profile, router]);
  return <div className="center">Loading...</div>;
}
