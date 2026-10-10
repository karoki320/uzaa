import { createClient } from '@supabase/supabase-js';

// The browser never talks to Supabase directly and never holds a token. Data calls go to our own
// /api/sb gateway, which reads the httpOnly session cookie and adds the credentials on the server.
const base = typeof window !== 'undefined' ? `${window.location.origin}/api/sb` : 'http://localhost/api/sb';

export const supabase = createClient(base, 'gateway', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
