import { randomBytes, createHash } from 'node:crypto';
import { COOKIE_OPTS } from './server';

// "Continue with Google" talks to Google directly, so Google's screen says Uzaa / uzaa.co.ke,
// not the Supabase project address. Google's ID token is then handed to Supabase (signInWithIdToken).
// Needs GOOGLE_CLIENT_SECRET in Vercel; without it Uzaa falls back to Supabase's own Google flow.
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '605867850637-g5886qotocrq3hcko4hidhio9drn0t1t.apps.googleusercontent.com';
export const googleDirect = () => Boolean(process.env.GOOGLE_CLIENT_SECRET);
export const G_COOKIE = 'uzaa_g';
const sha256hex = (v) => createHash('sha256').update(v).digest('hex');

export function googleStart(origin, next) {
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const q = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/auth/google`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce: sha256hex(nonce),         // Supabase checks the hashed nonce in the token against the raw one
    prompt: 'select_account',
  });
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${q}`,
    cookie: [G_COOKIE, JSON.stringify({ state, nonce, next }), { ...COOKIE_OPTS, maxAge: 600 }],
  };
}

export function readGoogleCookie(jar) {
  try { const v = JSON.parse(jar.get(G_COOKIE)?.value || 'null'); return v && v.state && v.nonce ? v : null; } catch { return null; }
}

/** Swaps Google's one-time code for an ID token. */
export async function googleToken(origin, code) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${origin}/auth/google`, grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  });
  const j = await r.json().catch(() => ({}));
  return r.ok && j.id_token ? j.id_token : null;
}
