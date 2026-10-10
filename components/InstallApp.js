'use client';
import { useState } from 'react';
import { useInstall } from '@/lib/pwa';

// "Install app" control. Shows nothing once installed. iPhone has no install prompt, so it shows the steps.
export default function InstallApp({ className = 'btn small', onDone, children }) {
  const { installed, canPrompt, ios, install } = useInstall();
  const [help, setHelp] = useState(false);
  if (installed) return null;
  if (!canPrompt && !ios) return null;
  return (
    <>
      <button type="button" className={className} onClick={async () => { if (canPrompt) { await install(); onDone && onDone(); } else setHelp((v) => !v); }}>
        {children || 'Install app'}
      </button>
      {help && !canPrompt && (
        <div className="note small" role="note">
          On iPhone: tap the Share button in Safari, then "Add to Home Screen".
        </div>
      )}
    </>
  );
}
