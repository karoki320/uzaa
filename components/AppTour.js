'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// First-time guided tour: dims the screen, lights up one thing at a time, says in one line what it is for.
//   "app"  once after the first sign-in: where to sell, add products, stock, sales, reports, staff, settings, help
//   "pos"  the first time on the till: categories, + New, search, items, the cart
// Each is shown once per person on this phone. Replay from More > Take the tour (or the Tour button on a computer).
const VER = 1;
const key = (uid, name) => `uzaa_tour_${name}_v${VER}_${uid}`;
const seen = (uid, name) => { try { return !!localStorage.getItem(key(uid, name)); } catch { return true; } };
const mark = (uid, name) => { try { localStorage.setItem(key(uid, name), '1'); } catch {} };

// a nav item: the tab on a computer, the bottom bar on a phone, or "More" when it lives in the More sheet
const nav = (href) => [`.tabs a[href="${href}"]`, `.bnav a[href="${href}"]`];
const MORE = '.bnav button[aria-haspopup]';

const APP_STEPS = [
  { href: '/pos', title: 'Sell', text: 'Your till. Tap items, take cash or M-Pesa. Works offline too.' },
  { href: '/products', title: 'Products', text: 'Add your items and prices here.' },
  { href: '/stock', title: 'Stock', text: 'Receive new stock and see what is running low.' },
  { href: '/sales', title: 'Sales', text: 'Every sale and the day\'s totals. Reverse a wrong sale here.' },
  { href: '/credit', title: 'Credit', text: 'Customers who owe you, and payments as they come in.' },
  { href: '/expenses', title: 'Expenses', text: 'Record rent, transport and other costs.' },
  { href: '/reports', title: 'Reports', text: 'Profit, best sellers and what stands out.' },
  { href: '/staff', title: 'Staff', text: 'Add cashiers. Each one signs in on their own phone.' },
  { href: '/settings', title: 'Settings', text: 'Shop name, logo, receipt and e-receipts.' },
  { sel: ['.ua-fab', '.ua-peek'], title: 'Help', text: 'Stuck? Tap Uzaa and ask anything.', help: true },
];
const POS_STEPS = [
  { sel: ['.pos .chips'], title: 'Categories', text: 'Tap a category to see only those items.' },
  { sel: ['.pos .addbtn'], title: 'New item', text: 'Not in the shop yet? Add it and sell it in one go.' },
  { sel: ['.pos .posbar button[aria-label="Search"]'], title: 'Search or scan', text: 'Find an item by name or barcode.' },
  { sel: ['.pos .tiles .tile'], title: 'Items', text: 'Tap an item to add it. Tap again for more.' },
  { sel: ['.pos .cart'], title: 'The sale', text: 'Check the items, pick Cash, M-Pesa or Split, then Charge.' },
];

function findEl(list) {
  for (const s of list) {
    for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
    }
  }
  return null;
}

export default function AppTour({ uid, name, role, items }) {
  const path = usePathname() || '';
  const router = useRouter();
  const [tour, setTour] = useState(null);   // { name, i, steps }
  const [box, setBox] = useState(null);     // spotlight rect
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  const hrefs = useMemo(() => new Set((items || []).map((n) => n.href)), [items]);

  const build = useCallback((which) => {
    if (which === 'pos') return POS_STEPS.map((s) => ({ ...s }));
    const steps = APP_STEPS.filter((s) => !s.href || hrefs.has(s.href)).map((s) => ({ ...s, sel: s.sel || nav(s.href) }));
    return [{ center: true, intro: true }, ...steps, { center: true, end: true }];
  }, [hrefs]);

  const start = useCallback((which) => setTour({ name: which, i: 0, steps: build(which) }), [build]);

  // first time: the app tour; then, the first time on the till, the till tour
  useEffect(() => {
    if (!uid || tour) return;
    const t = setTimeout(() => {
      if (document.querySelector('.overlay, .sheet-back, .scanwrap')) return;   // never on top of an open window
      if (!seen(uid, 'app')) start('app');
      else if (path.startsWith('/pos') && !seen(uid, 'pos') && document.querySelector('.pos .tiles .tile')) start('pos');
    }, 1200);
    return () => clearTimeout(t);
  }, [uid, path, tour, start]);

  // replay on request (More > Take the tour)
  useEffect(() => {
    const h = (e) => start(e.detail === 'pos' ? 'pos' : 'app');
    window.addEventListener('uzaa:tour', h);
    return () => window.removeEventListener('uzaa:tour', h);
  }, [start]);

  const step = tour?.steps[tour.i];
  const close = useCallback(() => { if (tour) mark(uid, tour.name); setTour(null); setBox(null); }, [tour, uid]);

  // light up this step's element; a step whose element is not on screen falls back to "More", or is skipped
  const place = useCallback(() => {
    if (!step || step.center) { setBox(null); return; }
    let el = findEl(step.sel);
    let viaMore = false;
    if (!el && step.href) { el = findEl([MORE]); viaMore = !!el; }
    if (!el) { setTour((t) => { if (!t) return t; const steps = t.steps.filter((_, k) => k !== t.i); return steps.length ? { ...t, steps, i: Math.min(t.i, steps.length - 1) } : null; }); return; }
    const r0 = el.getBoundingClientRect();
    if (r0.top < 0 || r0.bottom > window.innerHeight) el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const pad = 6;
    setBox({ x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2, viaMore });
  }, [step]);
  useLayoutEffect(() => { place(); }, [place, tour?.i]);
  useEffect(() => {
    if (!tour) return;
    const f = () => place();
    window.addEventListener('resize', f);
    window.addEventListener('scroll', f, true);
    return () => { window.removeEventListener('resize', f); window.removeEventListener('scroll', f, true); };
  }, [tour, place]);

  // the assistant steps aside during the tour, except on its own step
  useEffect(() => {
    const d = document.documentElement.dataset;
    if (tour) d.tour = step?.help ? 'help' : 'on'; else delete d.tour;
    return () => { delete d.tour; };
  }, [tour, step]);

  const next = () => (tour.i >= tour.steps.length - 1 ? close() : setTour({ ...tour, i: tour.i + 1 }));
  const back = () => tour.i > 0 && setTour({ ...tour, i: tour.i - 1 });
  useEffect(() => {
    if (!tour) return;
    const k = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') back(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }); // eslint-disable-line

  if (!tour || !step) return null;

  const real = tour.steps.filter((s) => !s.center).length;
  const n = tour.steps.slice(0, tour.i + 1).filter((s) => !s.center).length;
  const cashier = role === 'cashier';

  // where the card goes: under the spotlight if there is room, otherwise above it
  let cardStyle = {};
  if (box) {
    const vw = window.innerWidth, vh = window.innerHeight, w = Math.min(330, vw - 24);
    const left = Math.max(12, Math.min(box.x + box.w / 2 - w / 2, vw - w - 12));
    const below = box.y + box.h + 12;
    cardStyle = below + 190 < vh ? { width: w, left, top: below } : { width: w, left, bottom: Math.max(12, vh - box.y + 12) };
  }

  let body;
  if (step.intro) {
    body = (
      <>
        <div className="tour-k">Welcome</div>
        <h3>Karibu{first ? `, ${first}` : ''}!</h3>
        <p>Let us show you where everything is. It takes one minute.</p>
        <div className="tour-row">
          <button type="button" className="btn" onClick={close}>Skip</button>
          <button type="button" className="btn primary" onClick={next} autoFocus>Start the tour</button>
        </div>
      </>
    );
  } else if (step.end) {
    body = (
      <>
        <div className="tour-k">Done</div>
        <h3>You are ready</h3>
        <p>{cashier ? 'Open the till and make your first sale.' : 'Add your items, then make your first sale.'}</p>
        <p className="small muted">See this again any time: More, then Take the tour.</p>
        <div className="tour-row">
          {!cashier && <button type="button" className="btn" onClick={() => { close(); router.push('/products'); }}>Add products</button>}
          <button type="button" className="btn primary" autoFocus onClick={() => { close(); router.push('/pos'); }}>Open the till</button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className="tour-k">{n} of {real}</div>
        <h3>{step.title}</h3>
        <p>{box?.viaMore ? `Tap More, then ${step.title}. ${step.text}` : step.text}</p>
        <div className="tour-dots" aria-hidden="true">{Array.from({ length: real }, (_, k) => <i key={k} className={k === n - 1 ? 'on' : ''} />)}</div>
        <div className="tour-row">
          <button type="button" className="linkbtn" onClick={close}>Skip</button>
          <span className="grow" />
          {tour.i > 0 && !tour.steps[tour.i - 1].center && <button type="button" className="btn small" onClick={back}>Back</button>}
          <button type="button" className="btn small primary" onClick={next} autoFocus>{n === real ? 'Finish' : 'Next'}</button>
        </div>
      </>
    );
  }

  return (
    <div className="tour no-print" role="dialog" aria-modal="true" aria-label="Uzaa tour">
      {box
        ? <div className="tour-spot" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
        : <div className="tour-dim" />}
      <div className={`tour-card ${box ? '' : 'center'}`} style={cardStyle}>{body}</div>
    </div>
  );
}
