'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
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
    setState({ loading: false, session, me, profile: me.profile || null, business: me.business || null, branches: me.branches || [] });
  }, []);

  useEffect(() => { load(); }, [load]);

  const signOut = useCallback(async () => {
    await post('/api/auth/logout');
    go('/login');
  }, []);

  return <Ctx.Provider value={{ ...state, reload: load, signOut }}>{children}</Ctx.Provider>;
}
