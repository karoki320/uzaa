'use client';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';

const KEY = 'uzaa_paper';
const read = () => { try { return localStorage.getItem(KEY) === '48' ? 48 : 32; } catch { return 32; } };

// Prints a receipt two ways: the phone browser's print (PC / USB printers) and the Bluetooth Print
// Android app (Xprinter and other thermal printers). The link is fetched ahead so the button is a real link.
export default function PrintButtons({ saleId, auto = false }) {
  const [width, setWidth] = useState(32);
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { setWidth(read()); }, []);
  useEffect(() => {
    let dead = false;
    setUrl(''); setErr('');
    if (!saleId) return;
    post('/api/print/link', { sale_id: saleId, width }).then((r) => {
      if (dead) return;
      r.ok ? setUrl(r.data.url) : setErr(r.data.error || 'Could not prepare the print link');
    });
    return () => { dead = true; };
  }, [saleId, width]);

  const choose = (w) => { setWidth(w); try { localStorage.setItem(KEY, String(w)); } catch {} };
  const href = url ? `my.bluetoothprint.scheme://${url}` : undefined;

  return (
    <div className="stack no-print">
      <div className="row">
        {href ? <a className="btn primary grow" href={href} style={{ textAlign: 'center', textDecoration: 'none', lineHeight: '28px' }}>Print to Bluetooth printer</a>
              : <button className="btn primary grow" disabled>{err ? 'Bluetooth print unavailable' : 'Preparing print...'}</button>}
        <button className="btn grow" onClick={() => window.print()}>Print (this device)</button>
      </div>
      <div className="row small muted" style={{ justifyContent: 'space-between' }}>
        <span>Paper:&nbsp;
          <select className="input" style={{ width: 'auto', minHeight: 40, display: 'inline-block' }} value={width} onChange={(e) => choose(Number(e.target.value))} aria-label="Paper width">
            <option value={32}>58 mm</option><option value={48}>80 mm</option>
          </select>
        </span>
        <span>Needs the Bluetooth Print app on Android</span>
      </div>
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}
