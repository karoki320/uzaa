'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { answer, forRole, SUGGEST, KB } from '@/lib/assistant-kb';

// Uzaa Assistant: a friendly guide with a face. Built in (no AI service): it answers from the
// how-to library in lib/assistant-kb.js, knows who you are and which screen you are on, and its face
// reacts: it blinks, follows your finger or mouse, thinks while it looks, smiles when it finds the
// answer and looks sorry when it cannot.

// Mouth and eyebrow shapes per mood (viewBox 0 0 100 100).
const MOUTH = {
  idle: 'M36 66 Q50 76 64 66',
  happy: 'M32 62 Q50 84 68 62 Q50 70 32 62 Z',
  thinking: 'M40 69 Q50 67 60 69',
  surprised: 'M45 66 Q50 58 55 66 Q50 76 45 66 Z',
  sorry: 'M38 72 Q50 63 62 72',
  sleep: 'M42 68 Q50 72 58 68',
};
const BROW_L = { idle: 'M28 33 Q35 29 42 33', happy: 'M28 31 Q35 26 42 31', thinking: 'M28 30 Q35 27 42 32', surprised: 'M28 27 Q35 21 42 27', sorry: 'M28 30 Q35 33 42 34', sleep: 'M28 35 Q35 34 42 35' };
const BROW_R = { idle: 'M58 33 Q65 29 72 33', happy: 'M58 31 Q65 26 72 31', thinking: 'M58 34 Q65 31 72 34', surprised: 'M58 27 Q65 21 72 27', sorry: 'M58 34 Q65 33 72 30', sleep: 'M58 35 Q65 34 72 35' };

export function UzaaFace({ mood = 'idle', look = { x: 0, y: 0 }, size = 64, blink = false }) {
  const closed = blink || mood === 'sleep';
  const eyeSquash = mood === 'happy' ? 0.55 : 1;
  const px = mood === 'thinking' ? -2.5 : look.x * 3.2;
  const py = mood === 'thinking' ? -3.5 : look.y * 2.6;
  return (
    <svg className={`uzface m-${mood}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="uzg" cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#2f86bd" /><stop offset="1" stopColor="#0b5c87" /></radialGradient>
      </defs>
      {/* antenna: the arrow from the Uzaa mark */}
      <path className="uz-ant" d="M50 3 L58 14 H54 V20 H46 V14 H42 Z" fill="#f5b82e" />
      <circle cx="50" cy="56" r="40" fill="url(#uzg)" />
      <ellipse cx="50" cy="56" rx="40" ry="40" fill="none" stroke="#08476a" strokeWidth="1.5" opacity=".35" />
      <circle cx="27" cy="64" r="6" fill="#ff8fa3" opacity={mood === 'happy' ? 0.55 : 0.25} />
      <circle cx="73" cy="64" r="6" fill="#ff8fa3" opacity={mood === 'happy' ? 0.55 : 0.25} />
      <path className="uz-brow" d={BROW_L[mood] || BROW_L.idle} style={{ d: `path('${BROW_L[mood] || BROW_L.idle}')` }} stroke="#eaf5fc" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <path className="uz-brow" d={BROW_R[mood] || BROW_R.idle} style={{ d: `path('${BROW_R[mood] || BROW_R.idle}')` }} stroke="#eaf5fc" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      {[35, 65].map((cx) => (
        <g key={cx} className="uz-eye" style={{ transform: `scaleY(${closed ? 0.08 : eyeSquash})`, transformOrigin: `${cx}px 46px` }}>
          <ellipse cx={cx} cy="46" rx="8.5" ry={mood === 'surprised' ? 11 : 9.5} fill="#fff" />
          <circle cx={cx + px} cy={46 + py} r={mood === 'surprised' ? 3.6 : 4.4} fill="#14181f" />
          <circle cx={cx + px + 1.6} cy={46 + py - 1.8} r="1.3" fill="#fff" />
        </g>
      ))}
      <path className="uz-mouth" d={MOUTH[mood] || MOUTH.idle} style={{ d: `path('${MOUTH[mood] || MOUTH.idle}')` }}
        stroke="#eaf5fc" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"
        fill={mood === 'happy' || mood === 'surprised' ? '#7a1f2b' : 'none'} />
      {mood === 'thinking' && <g className="uz-dots" fill="#2f86bd"><circle cx="78" cy="22" r="3" /><circle cx="86" cy="14" r="4" /></g>}
      {mood === 'sleep' && <text x="74" y="24" fontSize="14" fontWeight="800" fill="#0b5c87" fontFamily="system-ui">z</text>}
    </svg>
  );
}

const HELLO = (name) => `Hi ${name || 'there'}! I'm Uzaa, your guide. Ask me anything about the app, or tap a suggestion below.`;
const ROLE_WORD = { owner: 'owner', manager: 'manager', cashier: 'cashier', super_admin: 'Uzaa admin', sales: 'sales agent' };

export default function UzaaAssistant({ role, name }) {
  const path = usePathname();
  const first = String(name || '').split(' ')[0];
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [mood, setMood] = useState('idle');
  const [blink, setBlink] = useState(false);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [bubble, setBubble] = useState('');
  const [msgs, setMsgs] = useState(() => [{ from: 'bot', text: HELLO(first) }]);
  const [q, setQ] = useState('');
  const face = useRef(null);
  const list = useRef(null);
  const idle = useRef(Date.now());
  const moodTimer = useRef(null);

  // remembered per device
  useEffect(() => {
    try {
      setHidden(localStorage.getItem('uzaa_bot_hidden') === '1');
      const day = new Date().toDateString();
      if (localStorage.getItem('uzaa_bot_hello') !== day) {
        localStorage.setItem('uzaa_bot_hello', day);
        const t1 = setTimeout(() => { setBubble(`Hi ${first || 'there'}! Need a hand? Tap me.`); setMood('happy'); }, 1500);
        const t2 = setTimeout(() => { setBubble(''); setMood('idle'); }, 8000);
        return () => { clearTimeout(t1); clearTimeout(t2); };
      }
    } catch {}
  }, [first]);

  const feel = useCallback((m, ms = 2200) => {
    setMood(m);
    clearTimeout(moodTimer.current);
    if (ms) moodTimer.current = setTimeout(() => setMood('idle'), ms);
  }, []);

  // blinking, and dozing off when nobody has touched anything for a while
  useEffect(() => {
    let t;
    const loop = () => {
      t = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 140);
        if (Date.now() - idle.current > 90e3) setMood((m) => (m === 'idle' ? 'sleep' : m));
        loop();
      }, 2500 + Math.random() * 3000);
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  // eyes follow the pointer
  useEffect(() => {
    const onMove = (e) => {
      idle.current = Date.now();
      setMood((m) => (m === 'sleep' ? 'idle' : m));
      const el = face.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - (r.left + r.width / 2); const dy = p.clientY - (r.top + r.height / 2);
      const d = Math.max(1, Math.hypot(dx, dy));
      const k = Math.min(1, d / 260);
      setLook({ x: (dx / d) * k, y: (dy / d) * k });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('touchstart', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('touchstart', onMove); };
  }, []);

  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [msgs, open]);

  const base = '/' + (path.split('/')[1] || '');
  const tips = forRole(SUGGEST[base] || [], role);
  const general = forRole(['install', 'security', 'reports', 'sell', 'onboard', 'agentbiz'], role).filter((k) => !tips.includes(k));
  const chips = [...tips, ...general].slice(0, 5);

  function reply(k) {
    setMsgs((m) => [...m, { from: 'me', text: k.title }, { from: 'bot', card: k }]);
    feel('happy');
  }

  function ask(e) {
    e?.preventDefault();
    const text = q.trim();
    if (!text) return;
    setQ('');
    setMsgs((m) => [...m, { from: 'me', text }, { from: 'bot', typing: true }]);
    feel('thinking', 0);
    setTimeout(() => {
      const hits = answer(text, role);
      const greet = /^(hi|hello|hey|habari|mambo|niaje|sasa|good (morning|afternoon|evening))\b/i.test(text);
      const thanks = /\b(thanks|thank you|asante|great|nice|cool)\b/i.test(text);
      setMsgs((m) => {
        const rest = m.filter((x) => !x.typing);
        if (hits.length) return [...rest, { from: 'bot', card: hits[0] }, ...(hits.length > 1 ? [{ from: 'bot', more: hits.slice(1) }] : [])];
        if (greet) return [...rest, { from: 'bot', text: `Hello ${first || ''}! What would you like to do today?`.replace(' !', '!') }];
        if (thanks) return [...rest, { from: 'bot', text: 'Karibu! I am right here if you need anything else.' }];
        return [...rest, { from: 'bot', text: 'Hmm, I am not sure about that one yet. Try other words like "add stock", "print receipt" or "add a cashier", or pick one below.', sorry: true }];
      });
      feel(hits.length || greet || thanks ? 'happy' : 'sorry', 2600);
    }, 650);
  }

  function toggle() {
    idle.current = Date.now();
    setBubble('');
    setOpen((o) => !o);
    feel(open ? 'idle' : 'happy', 1600);
  }

  function hide() {
    try { localStorage.setItem('uzaa_bot_hidden', '1'); } catch {}
    setHidden(true); setOpen(false);
  }
  function unhide() {
    try { localStorage.removeItem('uzaa_bot_hidden'); } catch {}
    setHidden(false); feel('happy');
  }

  if (hidden) {
    return <button type="button" className="ua-peek no-print" onClick={unhide} aria-label="Show Uzaa Assistant"><UzaaFace size={30} mood="idle" look={look} blink={blink} /></button>;
  }

  return (
    <div className={`ua no-print ${base === '/pos' ? 'ua-pos' : ''}`}>
      {open && (
        <section className="ua-panel" role="dialog" aria-label="Uzaa Assistant">
          <header className="ua-head">
            <UzaaFace size={46} mood={mood} look={look} blink={blink} />
            <div className="grow" style={{ minWidth: 0 }}>
              <b>Uzaa Assistant</b>
              <div className="small" style={{ opacity: 0.85 }}>{mood === 'thinking' ? 'Looking that up...' : `Helping you as ${ROLE_WORD[role] || 'a user'}`}</div>
            </div>
            <button type="button" className="ua-x" onClick={hide} title="Hide the assistant">Hide</button>
            <button type="button" className="ua-x" onClick={toggle} aria-label="Close">&times;</button>
          </header>

          <div className="ua-msgs" ref={list} aria-live="polite">
            {msgs.map((m, i) => {
              if (m.typing) return <div key={i} className="ua-msg bot"><span className="ua-typing"><i /><i /><i /></span></div>;
              if (m.card) return (
                <div key={i} className="ua-msg bot ua-card">
                  <b>{m.card.title}</b>
                  <ol>{m.card.steps.map((s, j) => <li key={j}>{s}</li>)}</ol>
                  {m.card.href && base !== m.card.href && <Link className="ua-go" href={m.card.href} onClick={() => feel('happy')}>{m.card.go || 'Take me there'} &rarr;</Link>}
                </div>
              );
              if (m.more) return (
                <div key={i} className="ua-msg bot">
                  <span className="small">Or did you mean:</span>
                  <div className="ua-chips">{m.more.map((k) => <button type="button" key={k.id} onClick={() => reply(k)}>{k.title}</button>)}</div>
                </div>
              );
              return <div key={i} className={`ua-msg ${m.from}`}>{m.text}</div>;
            })}
          </div>

          <div className="ua-chips ua-sugg">
            {chips.map((k) => <button type="button" key={k.id} onClick={() => reply(k)}>{k.title}</button>)}
          </div>
          <form className="ua-ask" onSubmit={ask}>
            <input className="input" value={q} onChange={(e) => { setQ(e.target.value); if (mood !== 'thinking') setMood(e.target.value ? 'surprised' : 'idle'); }}
              placeholder="Ask me, e.g. how do I add stock?" aria-label="Ask the Uzaa Assistant" maxLength={200} />
            <button className="btn primary" aria-label="Ask">Ask</button>
          </form>
        </section>
      )}

      {bubble && !open && <button type="button" className="ua-bubble" onClick={toggle}>{bubble}</button>}
      <button type="button" ref={face} className={`ua-fab m-${mood}`} onClick={toggle}
        onMouseEnter={() => mood === 'idle' && feel('surprised', 900)}
        aria-label={open ? 'Close Uzaa Assistant' : 'Open Uzaa Assistant'} aria-expanded={open}>
        <UzaaFace size={58} mood={mood} look={look} blink={blink} />
      </button>
    </div>
  );
}

export const ASSISTANT_TOPICS = KB.length;
