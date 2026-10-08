'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

const NAV = [
  { href: '/pos', label: 'Sell', roles: ['owner', 'manager', 'cashier'] },
  { href: '/sales', label: 'Sales', roles: ['owner', 'manager', 'cashier'] },
  { href: '/products', label: 'Products', roles: ['owner', 'manager'] },
  { href: '/stock', label: 'Stock', roles: ['owner', 'manager'] },
  { href: '/reports', label: 'Reports', roles: ['owner', 'manager'] },
  { href: '/branches', label: 'Branches', roles: ['owner'] },
  { href: '/staff', label: 'Staff', roles: ['owner'] },
  { href: '/settings', label: 'Settings', roles: ['owner'] },
  { href: '/admin', label: 'All businesses', roles: ['super_admin'] },
];

export default function Shell({ children }) {
  const { loading, session, profile, business, branches } = useAuth();
  const router = useRouter();
  const path = usePathname();

  const items = profile ? NAV.filter((n) => n.roles.includes(profile.role)) : [];
  const allowed = items.some((n) => path.startsWith(n.href));

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (!profile) router.replace('/signup');
    else if (!allowed && items.length) router.replace(items[0].href);
  }, [loading, session, profile, allowed, items.length, router]); // eslint-disable-line

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  if (loading || !session || !profile) return <div className="center">Loading...</div>;

  if (!profile.active || (business && business.status !== 'active')) {
    return (
      <div className="auth">
        <div className="card">
          <h2>Account unavailable</h2>
          <p>
            {!profile.active
              ? 'Your account has been disabled. Please contact your business owner.'
              : 'This business account is suspended. Please contact Uzaa support.'}
          </p>
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }

  const myBranch = branches.find((b) => b.id === profile.branch_id);

  return (
    <>
      <div className="shell-head no-print">
        <div>
          <span className="brand">Uzaa</span>
          {business && <span className="muted small"> &nbsp;{business.name}{myBranch ? ` / ${myBranch.name}` : ''}</span>}
        </div>
        <div className="row">
          <span className="small muted">{profile.full_name} <span className="badge">{profile.role.replace('_', ' ')}</span></span>
          <button className="btn small" onClick={signOut}>Sign out</button>
        </div>
      </div>
      <nav className="tabs no-print">
        {items.map((n) => (
          <Link key={n.href} href={n.href} className={`tab ${path.startsWith(n.href) ? 'active' : ''}`}>{n.label}</Link>
        ))}
      </nav>
      <main className="page">{allowed ? children : null}</main>
    </>
  );
}
