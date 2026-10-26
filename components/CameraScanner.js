'use client';
import { useEffect, useRef, useState } from 'react';
import { decodeImage, nativeReader } from '@/lib/barcode';

// The phone camera as a barcode scanner. Point it at a code: it beeps, hands the code to onCode,
// and keeps scanning for the next item (like a handheld scanner). With `single`, it stops after one code.
//
// onCode(code) may return (or resolve to) { ok, text, action: { label, run } } to show under the picture.
export default function CameraScanner({ title = 'Scan barcode', onCode, onClose, single = false, children }) {
  const video = useRef(null);
  const canvas = useRef(null);
  const stream = useRef(null);
  const busy = useRef(false);
  const last = useRef({ code: '', at: 0 });
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [state, setState] = useState('starting');   // starting | on | error
  const [problem, setProblem] = useState('');
  const [msg, setMsg] = useState(null);
  const [torch, setTorch] = useState(null);          // null: the camera has no light
  const [typed, setTyped] = useState('');
  const [engine, setEngine] = useState('');

  async function handle(code) {
    if (!code || busy.current) return null;
    const now = Date.now();
    // a code held in view counts once (like pressing a scanner's trigger once). To count the same item again,
    // move it out of view for a second and back
    if (code === last.current.code && now - last.current.at < 1200) { last.current.at = now; return null; }
    last.current = { code, at: now };
    busy.current = true;
    beep(true);
    try { navigator.vibrate?.(60); } catch { /* not supported */ }
    setMsg({ ok: true, text: `${code}...` });
    let res;
    try { res = await onCodeRef.current?.(code); } catch (e) { res = { ok: false, text: e?.message || 'Something went wrong' }; }
    if (res && res.ok === false) beep(false);
    setMsg(res ? { ...res, code } : { ok: true, text: code, code });
    busy.current = false;
    last.current = { code, at: Date.now() };
    return res;
  }

  useEffect(() => {
    let stop = false;
    let timer = null;

    async function start() {
      if (!window.isSecureContext) {
        setProblem('The camera only works on a secure (https) address. Open the app from its https link.');
        return setState('error');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem('This browser cannot use the camera. Try Chrome, or type the barcode below.');
        return setState('error');
      }
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (e) {
        const n = e?.name || '';
        setProblem(
          n === 'NotAllowedError' || n === 'SecurityError'
            ? 'Camera permission was refused. Allow the camera for this site in the browser settings (the lock or camera icon by the address), then try again.'
            : n === 'NotFoundError' || n === 'OverconstrainedError'
              ? 'No camera found on this device. Type the barcode below instead.'
              : n === 'NotReadableError'
                ? 'The camera is busy in another app. Close that app and try again.'
                : `Could not start the camera (${n || 'unknown error'}).`
        );
        return setState('error');
      }
      if (stop) { stream.current.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current;
      v.srcObject = stream.current;
      try { await v.play(); } catch { /* starts when ready */ }
      const track = stream.current.getVideoTracks()[0];
      try {
        const caps = track.getCapabilities?.() || {};
        if (caps.torch) setTorch(false);
        if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      } catch { /* optional */ }
      setState('on');

      const native = await nativeReader();
      setEngine(native ? 'native' : 'built-in');
      const tick = async () => {
        if (stop) return;
        try {
          if (v.readyState >= 2 && !busy.current) {
            let code = null;
            if (native) code = await native(v);
            else code = readFrame(v, canvas.current);
            if (code && !stop) {
              const res = await handle(code);
              if (single && res && res.ok !== false) return;   // the parent closes the scanner
            }
          }
        } catch { /* a bad frame: try the next */ }
        timer = setTimeout(tick, native ? 120 : 60);
      };
      tick();
    }
    start();
    return () => {
      stop = true;
      clearTimeout(timer);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // caught first, so Escape closes only the scanner and not a form open beneath it
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);

  async function toggleTorch() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch { setTorch(null); }
  }

  function submitTyped(e) {
    e.preventDefault();
    const t = typed.trim();
    if (!t) return;
    last.current = { code: '', at: 0 };
    setTyped('');
    handle(t);
  }

  return (
    <div className="scanwrap" role="dialog" aria-modal="true" aria-label={title}>
      <div className="scanbox">
        <div className="row between scanhead">
          <b>{title}</b>
          <button className="btn small" onClick={onClose}>{single ? 'Cancel' : 'Done'}</button>
        </div>

        <div className="scanview">
          <video ref={video} playsInline muted autoPlay />
          <canvas ref={canvas} hidden />
          {state === 'on' && <div className="scanaim" aria-hidden="true"><i /></div>}
          {state === 'starting' && <div className="scancover">Starting camera...</div>}
          {state === 'error' && <div className="scancover">{problem}</div>}
          {torch !== null && (
            <button type="button" className={`scantorch ${torch ? 'on' : ''}`} onClick={toggleTorch} aria-pressed={torch}>
              {torch ? 'Light off' : 'Light on'}
            </button>
          )}
        </div>
        {state === 'on' && <p className="small muted scanhint">Hold the barcode flat inside the box, about a hand's length away, in good light.</p>}

        {msg && (
          <div className={`scanmsg ${msg.ok === false ? 'bad' : 'good'}`} role="status">
            <div>{msg.text}</div>
            {msg.action && <button className="btn small" onClick={msg.action.run}>{msg.action.label}</button>}
          </div>
        )}

        {children}

        <form className="row scantype" onSubmit={submitTyped}>
          <input className="input grow" inputMode="numeric" placeholder="Or type the barcode number" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Barcode number" />
          <button className="btn small">Enter</button>
        </form>
        {engine === 'built-in' && <p className="small muted" style={{ margin: '6px 0 0' }}>This browser reads EAN and UPC codes (the ones on shop products). For other code types use Chrome on Android.</p>}
      </div>
    </div>
  );
}

// Grabs the middle of the picture and looks for a code in it.
function readFrame(v, c) {
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh || !c) return null;
  // the middle 90% across and 60% down, at most 960 points wide: enough detail, quick to read
  const sw = Math.round(vw * 0.9), sh = Math.round(vh * 0.6);
  const scale = Math.min(1, 960 / sw);
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h);
  return decodeImage(ctx.getImageData(0, 0, w, h));
}

let audio = null;
function beep(good) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = good ? 1900 : 300;
    o.type = good ? 'sine' : 'square';
    g.gain.value = 0.08;
    o.connect(g); g.connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + (good ? 0.09 : 0.25));
  } catch { /* no sound: fine */ }
}
