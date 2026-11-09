'use client';
import { useEffect, useRef, useState } from 'react';
import { post } from '@/lib/api';

// Signature pad: draw with a finger, stylus or mouse. Sent as a small white-background JPEG.
export default function SignAgreement({ token, name, uploaded }) {
  const box = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [drawn, setDrawn] = useState(false);
  const [f, setF] = useState({ name: name || '', title: '', agree: false, opened: !uploaded });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const c = box.current;
    const fit = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#fff'; g.fillRect(0, 0, r.width, r.height);
      g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#14181f'; g.lineWidth = 2.6;
      setDrawn(false);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const pt = (e) => { const r = box.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e) => { e.preventDefault(); box.current.setPointerCapture?.(e.pointerId); drawing.current = true; last.current = pt(e); };
  const move = (e) => {
    if (!drawing.current) return;
    const g = box.current.getContext('2d');
    const p = pt(e);
    g.beginPath(); g.moveTo(last.current.x, last.current.y); g.lineTo(p.x, p.y); g.stroke();
    last.current = p;
    if (!drawn) setDrawn(true);
  };
  const up = () => { drawing.current = false; };

  function clear() {
    const c = box.current; const g = c.getContext('2d');
    const r = c.getBoundingClientRect();
    g.fillStyle = '#fff'; g.fillRect(0, 0, r.width, r.height);
    setDrawn(false);
  }

  function image() {
    // a fixed size copy keeps the file small whatever the screen
    const out = document.createElement('canvas');
    out.width = 900; out.height = 300;
    const g = out.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 300);
    g.drawImage(box.current, 0, 0, 900, 300);
    return out.toDataURL('image/jpeg', 0.85);
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!f.opened) return setErr('Open and read the agreement first');
    if (!drawn) return setErr('Draw your signature in the box');
    if (!f.agree) return setErr('Tick the box to confirm you agree');
    setBusy(true);
    const r = await post(`/api/agreement/${token}/sign`, { name: f.name, title: f.title, agree: true, drawn: true, signature: image() });
    setBusy(false);
    if (!r.ok) return setErr(r.data.error || 'Could not save your signature');
    window.location.reload();
  }

  return (
    <form className="agr-sign" onSubmit={submit}>
      <h2>Sign the agreement</h2>
      {uploaded && (
        <label className="terms-tick">
          <input type="checkbox" checked={f.opened} onChange={(e) => setF({ ...f, opened: e.target.checked })} />
          <span>I have opened the agreement PDF above and read it.</span>
        </label>
      )}
      <label className="field"><span>Your full name</span>
        <input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />
      </label>
      <label className="field"><span>Your position (optional)</span>
        <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Proprietor, Director..." />
      </label>
      <div className="field">
        <span style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Your signature</span>
        <canvas
          ref={box} className="sigpad" aria-label="Signature box. Draw your signature here."
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
        />
        <div className="row between" style={{ marginTop: 6 }}>
          <span className="small muted">{drawn ? 'Looks good.' : 'Draw with your finger or mouse.'}</span>
          <button type="button" className="linkbtn" onClick={clear}>Clear</button>
        </div>
      </div>
      <label className="terms-tick">
        <input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} />
        <span>I have read and agree to this agreement, and I am authorised to sign it for {f.name ? 'myself and my business' : 'the business'}. I agree that my electronic signature is binding like a handwritten one.</span>
      </label>
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing...' : 'Sign agreement'}</button>
      <p className="small muted" style={{ marginTop: 10 }}>The date, time and your internet address are recorded with your signature.</p>
    </form>
  );
}
