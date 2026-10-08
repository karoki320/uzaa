'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

const empty = { loading: true, session: null, profile: null, business: null, branches: [] };

export function AuthProvider({ children }) {
  const [state, setState] = useState(empty);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const session = data?.session || null;
    if (!session) {
      setState({ ...empty, loading: false });
      return;
    }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
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
    setState({ loading: false, session, profile, business, branches });
  }, []);

  useEffect(() => {
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((ev) => {
      if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') load();
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  return <Ctx.Provider value={{ ...state, reload: load }}>{children}</Ctx.Provider>;
}
