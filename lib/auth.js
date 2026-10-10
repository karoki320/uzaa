'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { post, go } from './api';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

const empty = { loading: true, session: null, me: null, profile: null, business: null, branches: [] };

export function AuthProvider({ children }) {
  const [state, setState] = useState(empty);

  const load = useCallback(async () => {
    let me = null;
    try {
      const r = await fetch('/api/auth/me', { cache: 'no-store' });
      const j = await r.json();
      me = j.user ? j : null;
    } catch {}
    if (!me) {
      setState({ ...empty, loading: false });
      return;
    }
    const session = { user: me.user };
    if (me.needsMfa) {
      setState({ ...empty, loading: false, session, me });
      return;
    }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', me.user.id).maybeSingle();
    let business = null;
    let branches = [];
    if (profile?.business_id) {
      const [b, br] = await Promise.all([
        supabase.from('businesses').select('*').eq('id', profile.business_id).maybeSingle(),
        supabase.from('branches').select('*').eq('business_id', profile.business_id).order('created_at'),
      ]);
      business = b.data;
      branches = br.data || [];
    }
    setState({ loading: false, session, me, profile, business, branches });
  }, []);

  useEffect(() => { load(); }, [load]);

  const signOut = useCallback(async () => {
    await post('/api/auth/logout');
    go('/login');
  }, []);

  return <Ctx.Provider value={{ ...state, reload: load, signOut }}>{children}</Ctx.Provider>;
}
