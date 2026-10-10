'use client';
import { useEffect, useState } from 'react';
import { useInstall } from '@/lib/pwa';
import InstallApp from '@/components/InstallApp';

// Shown at the top of the app until the person installs it or closes it.
export default function InstallBanner() {
  const { installed } = useInstall();
  const [hide, setHide] = useState(true);
  useEffect(() => { try { setHide(localStorage.getItem('uzaa_install_hide') === '1'); } catch { setHide(false); } }, []);
  if (installed || hide) return null;
  return (
    <div className="installbar no-print">
      <div><b>Install Uzaa on this phone</b><div className="small muted">Opens full screen like an app, from your home screen.</div></div>
      <InstallApp className="btn small primary" />
      <button type="button" className="btn small" aria-label="Not now" onClick={() => { try { localStorage.setItem('uzaa_install_hide', '1'); } catch {} setHide(true); }}>Not now</button>
    </div>
  );
}
