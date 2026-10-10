'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import InstallApp from '@/components/InstallApp';

// Simple outline icons, one per screen (no emojis).
const P = {
  '/pos': <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /><path d="M7 9h4M7 12h7" /></>,
  '/sales': <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  '/products': <><path d="M3 8l9-5 9 5v8l-9 5-9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  '/stock': <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  '/credit': <><path d="M3 7h18v10H3z" /><circle cx="12" cy="12" r="2.5" /><path d="M7 12h.01M17 12h.01" /></>,
  '/reports': <><path d="M4 20h16" /><path d="M6 16l4-5 3 3 5-7" /></>,
  '/branches': <><path d="M3 21h18M5 21V9l7-5 7 5v12" /><path d="M10 21v-6h4v6" /></>,
  '/staff': <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6" /><path d="M16 5.2a3.5 3.5 0 010 5.6M18 14.4c2 .7 3.5 2.5 3.5 5.6" /></>,
  '/settings': <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>,
  '/admin': <><path d="M3 21h18M6 21V8h5v13M13 21V3h5v18" /></>,
  '/security': <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
  dl: <><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></>,
  out: <><path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4M16 8l4 4-4 4M20 12H9" /></>,
};
export const Icon = ({ k, size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[k] || P.more}</svg>
);

// Phone layout: tab bar fixed at the bottom (thumb reach), four main screens plus "More".
export default function BottomNav({ items, signOut, who }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const main = items.filter((n) => n.href !== '/security').slice(0, 4);
  const rest = items.filter((n) => !main.includes(n));
  const moreActive = rest.some((n) => path.startsWith(n.href));

  return (
    <>
      <nav className="bnav no-print" aria-label="Main">
        {main.map((n) => (
          <Link key={n.href} href={n.href} className={path.startsWith(n.href) ? 'on' : ''} aria-current={path.startsWith(n.href) ? 'page' : undefined}>
            <Icon k={n.href} /><span>{n.short || n.label}</span>
          </Link>
        ))}
        <button type="button" className={moreActive || more ? 'on' : ''} onClick={() => setMore(true)} aria-haspopup="dialog">
          <Icon k="more" /><span>More</span>
        </button>
      </nav>
      {more && (
        <div className="sheet-back no-print" onClick={() => setMore(false)} role="dialog" aria-modal="true" aria-label="More">
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            {who && <div className="muted small" style={{ marginBottom: 8 }}>{who}</div>}
            {rest.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setMore(false)} className={path.startsWith(n.href) ? 'on' : ''}>
                <Icon k={n.href} /><span>{n.label}</span>
              </Link>
            ))}
            <InstallApp className="sheetinstall" onDone={() => setMore(false)}><Icon k="dl" /><span>Install app on this phone</span></InstallApp>
            <button type="button" onClick={signOut}><Icon k="out" /><span>Sign out</span></button>
          </div>
        </div>
      )}
    </>
  );
}
