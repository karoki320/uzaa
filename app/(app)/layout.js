'use client';
import { useEffect } from 'react';
import Logo from '@/components/Logo';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import BottomNav from '@/components/BottomNav';
import InstallApp from '@/components/InstallApp';

const NAV = [
  { href: '/pos', label: 'Sell', roles: ['owner', 'manager', 'cashier'] },
  { href: '/sales', label: 'Sales', roles: ['owner', 'manager', 'cashier'] },
  { href: '/products', label: 'Products', roles: ['owner', 'manager'] },
  { href: '/stock', label: 'Stock', roles: ['owner', 'manager'] },
  { href: '/reports', label: 'Reports', roles: ['owner', 'manager'] },
  { href: '/branches', label: 'Branches', roles: ['owner'] },
  { href: '/staff', label: 'Staff', roles: ['owner'] },
  { href: '/settings', label: 'Settings', roles: ['owner'] },
  { href: '/admin', label: 'All businesses', short: 'Businesses', roles: ['super_admin'] },
  { href: '/security', label: 'Security', roles: ['owner', 'manager', 'cashier', 'super_admin'] },
];

export default function Shell({ children }) {
  const { loading, session, me, profile, business, branches, signOut } = useAuth();
  const router = useRouter();
  const path = usePathname();

  const items = profile ? NAV.filter((n) => n.roles.includes(profile.role)) : [];
  const allowed = items.some((n) => path.startsWith(n.href));

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (me?.needsMfa) router.replace('/mfa');
    else if (!profile) router.replace('/signup');
    else if (me?.mustEnrol && !path.startsWith('/security')) router.replace('/security?setup=1');
    else if (!allowed && items.length) router.replace(items[0].href);
  }, [loading, session, me, profile, allowed, items.length, path, router]); // eslint-disable-line

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
          <span className="brand" aria-label="Uzaa"><Logo height={30} /></span>
          {business && <span className="muted small"> &nbsp;{business.name}{myBranch ? ` / ${myBranch.name}` : ''}</span>}
        </div>
        <div className="row">
          <span className="small muted desk-only">{profile.full_name} <span className="badge">{profile.role.replace('_', ' ')}</span></span>
          <span className="desk-only"><InstallApp /></span>
          <button className="btn small desk-only" onClick={signOut}>Sign out</button>
        </div>
      </div>
      <nav className="tabs no-print desk-only">
        {items.map((n) => (
          <Link key={n.href} href={n.href} className={`tab ${path.startsWith(n.href) ? 'active' : ''}`}>{n.label}</Link>
        ))}
      </nav>
      <main className="page">{allowed ? children : null}</main>
      <BottomNav items={items} signOut={signOut} who={`${profile.full_name} (${profile.role.replace('_', ' ')})`} />
    </>
  );
}
