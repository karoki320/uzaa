'use client';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';
import { paperWidth, schemeUrl } from '@/lib/printclient';

// One print button: sends the receipt to the Bluetooth printer through the Bluetooth Print app.
// The link is fetched ahead so the button is a real link and works first tap.
export default function PrintButtons({ saleId }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let dead = false;
    setUrl(''); setErr('');
    if (!saleId) return;
    post('/api/print/link', { sale_id: saleId, width: paperWidth() }).then((r) => {
      if (dead) return;
      r.ok ? setUrl(r.data.url) : setErr(r.data.error || 'Could not prepare the print link');
    });
    return () => { dead = true; };
  }, [saleId]);
  return (
    <div className="no-print">
      {url
        ? <a className="btn primary" href={schemeUrl(url)} style={{ display: 'block', textAlign: 'center', textDecoration: 'none', lineHeight: '28px' }}>Print receipt</a>
        : <button className="btn primary" style={{ width: '100%' }} disabled>{err ? 'Print unavailable' : 'Preparing...'}</button>}
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
