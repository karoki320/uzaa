'use client';
import { useState } from 'react';
import { useInstall } from '@/lib/pwa';

// Install control. One tap installs when the browser allows it; otherwise it shows the exact steps
// for the phone in use (browsers only offer the install prompt when they decide the app qualifies).
export function InstallSteps({ ios }) {
  return (
    <div className="note small" role="note">
      {ios
        ? 'On iPhone: open Uzaa in Safari, tap the Share button, then "Add to Home Screen".'
        : 'On Android: open Uzaa in Chrome, tap the three-dot menu, then "Install app" (or "Add to Home screen").'}
    </div>
  );
}

export default function InstallApp({ className = 'btn small', onDone, children }) {
  const { installed, canPrompt, ios, install } = useInstall();
  const [help, setHelp] = useState(false);
  if (installed) return null;
  return (
    <>
      <button type="button" className={className} onClick={async () => { if (canPrompt) { await install(); onDone && onDone(); } else setHelp((v) => !v); }}>
        {children || 'Install app'}
      </button>
      {help && !canPrompt && <InstallSteps ios={ios} />}
    </>
  );
}
