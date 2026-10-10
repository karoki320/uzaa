'use client';
import { useEffect, useRef } from 'react';

export const captchaOn = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

// Cloudflare Turnstile. Shown only after repeated failures; renders nothing if it is not configured.
export default function Captcha({ onToken, resetKey = 0 }) {
  const box = useRef(null);
  const wid = useRef(null);
  useEffect(() => {
    if (!captchaOn) return;
    let dead = false;
    const draw = () => {
      if (dead || !box.current || !window.turnstile) return;
      if (wid.current != null) { try { window.turnstile.remove(wid.current); } catch {} }
      wid.current = window.turnstile.render(box.current, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
        callback: (t) => onToken(t),
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      });
    };
    if (window.turnstile) draw();
    else {
      let s = document.getElementById('cf-turnstile');
      if (!s) {
        s = document.createElement('script');
        s.id = 'cf-turnstile';
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        document.head.appendChild(s);
      }
      s.addEventListener('load', draw);
    }
    return () => { dead = true; };
  }, [resetKey]); // eslint-disable-line
  if (!captchaOn) return null;
  return <div ref={box} style={{ margin: '8px 0 12px' }} />;
}
