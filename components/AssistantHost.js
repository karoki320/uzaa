'use client';
import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import UzaaAssistant from '@/components/UzaaAssistant';

// Puts the Uzaa Assistant on every page from the first click, and decides what it starts with:
//   a visitor            the welcome questions (new to Uzaa? already a user? here to sign?)
//   the agreement page   help signing, then "what next" straight after signing
//   an owner, not live   what happens before activation
//   an owner, live       the setup questions and checklist until the business is set up
// The public landing page has its own copy (public/uzaa-assistant.js) since it is plain HTML.

const APP = ['/pos', '/sales', '/products', '/stock', '/credit', '/reports', '/branches', '/staff', '/settings', '/admin', '/agent', '/security'];
const HIDE = ['/r/', '/home'];   // customers' e-receipts belong to the shop, not to Uzaa

export default function AssistantHost() {
  const { loading, session, me, profile, business, branches } = useAuth() || {};
  const path = usePathname() || '/';
  const [page, setPage] = useState(null);       // context a page reports, e.g. the agreement
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    const h = (e) => setPage(e.detail || null);
    if (window.__uzaaPage) setPage(window.__uzaaPage);
    window.addEventListener('uzaa:page', h);
    return () => window.removeEventListener('uzaa:page', h);
  }, []);
  useEffect(() => { if (!path.startsWith('/agreement')) setPage(null); }, [path]);

  const role = session && profile && !me?.needsMfa ? profile.role : 'visitor';
  const live = business?.status === 'active';
  const owner = role === 'owner';

  // What the owner has already done, so the checklist ticks itself.
  const loadProgress = useCallback(async () => {
    if (!owner || !live || !business?.id) return;
    // these are four counting queries: run them at most every 5 minutes, and never again once the
    // shop has products and sales (the checklist is done), instead of on every page change
    const key = `uzaa_progress_${business.id}`;
    try {
      const c = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (c && (c.done || Date.now() - c.at < 5 * 60 * 1000)) { setProgress(c.p); return; }
    } catch {}
    const count = async (q) => { try { const { count: n } = await q; return n || 0; } catch { return 0; } };
    const [products, stocked, staff, sales] = await Promise.all([
      count(supabase.from('products').select('id', { count: 'exact', head: true })),
      count(supabase.from('stock').select('product_id', { count: 'exact', head: true }).gt('qty', 0)),
      count(supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('business_id', business.id)),
      count(supabase.from('sales').select('id', { count: 'exact', head: true })),
    ]);
    const p = {
      products, stocked, staff, sales, branches: (branches || []).length,
      ereceipt: !!business.ereceipt_enabled, credit: !!business.credit_enabled, mfa: !!me?.mfaEnrolled,
    };
    setProgress(p);
    try { sessionStorage.setItem(key, JSON.stringify({ p, at: Date.now(), done: products > 0 && sales > 0 })); } catch {}
  }, [owner, live, business, branches, me?.mfaEnrolled]);
  useEffect(() => { loadProgress(); }, [loadProgress, path]);

  if (loading || HIDE.some((h) => path.startsWith(h))) return null;

  const inApp = APP.some((p) => path === p || path.startsWith(p + '/'));
  const name = profile?.full_name || page?.name || '';
  let auto = null;
  const ctx = {};

  if (path.startsWith('/agreement')) {
    ctx.agreement = page ? { business: page.business, status: page.status } : null;
    if (page?.status === 'signed') auto = { flow: 'afterSign', key: `signed_${page.ref || 'x'}`, open: true, bubble: 'Signed! Tap me for your next steps.' };
    else if (page) auto = { flow: 'agreementHelp', key: `agr_${page.ref || 'x'}`, open: false, bubble: 'Need help signing? I can walk you through it.' };
  } else if (role === 'visitor') {
    auto = { flow: 'visitor', key: 'visitor', open: true, bubble: 'Hi! New to Uzaa or need help signing in? Tap me.' };
  } else if (owner && business && business.status === 'pending') {
    auto = { flow: 'pending', key: `pending_${business.id}`, open: true, bubble: 'Your account is almost ready. Tap me to see what happens next.' };
  } else if (owner && live && progress && !(progress.products > 0 && progress.sales > 0)) {
    auto = { flow: 'setup', key: `setup_${business.id}`, open: true, bubble: "Let's finish setting up your business. Tap me." };
  } else if (role !== 'visitor') {
    auto = { flow: null, key: `none_${role}` };
  }

  return (
    <UzaaAssistant
      role={role} name={name} auto={auto} ctx={ctx} progress={progress} businessId={business?.id || ''}
      nav={inApp && role !== 'visitor' && (!business || live)} onOpen={loadProgress}
    />
  );
}
