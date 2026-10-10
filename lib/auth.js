'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { post, go } from './api';
import { saveKv, getKv, clearShopCopy } from './offline';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

const empty = { loading: true, session: null, me: null, profile: null, business: null, branches: [], offline: false };

export function AuthProvider({ children }) {
  const [state, setState] = useState(empty);

  const load = useCallback(async () => {
    let me = null;
    let offline = false;
    try {
      const r = await fetch('/api/auth/me', { cache: 'no-store' });
      if (r.status >= 500) throw new Error('server');
      const j = await r.json();
      me = j.user ? j : null;
      if (me && !me.needsMfa && me.profile) saveKv('me', me);   // copy for offline start
    } catch {
      // no signal: open from the saved copy so the till still works
      const saved = await getKv('me');
      if (saved) { me = saved; offline = true; }
    }
    if (!me) {
      setState({ ...empty, loading: false });
      return;
    }
    const session = { user: me.user };
    setState({ loading: false, session, me, profile: me.profile || null, business: me.business || null, branches: me.branches || [], offline });
  }, []);

  useEffect(() => { load(); }, [load]);

  const signOut = useCallback(async () => {
    const r = await post('/api/auth/logout');
    if (r.status === 0) return false;   // offline: stay signed in, nothing is lost
    await clearShopCopy();   // unsent sales stay on the phone
    go('/login');
    return true;
  }, []);

  // when the connection comes back, re-check the sign-in (it may have expired while offline)
  useEffect(() => {
    const f = () => { if (state.offline) load(); };
    window.addEventListener('online', f);
    return () => window.removeEventListener('online', f);
  }, [state.offline, load]);

  return <Ctx.Provider value={{ ...state, reload: load, signOut }}>{children}</Ctx.Provider>;
}
