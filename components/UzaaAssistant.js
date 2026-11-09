'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { answerScored, forRole, SUGGEST, KB } from '@/lib/assistant-kb';
import { FLOWS, planItems } from '@/public/uzaa-flows.js';

// Uzaa Assistant: a friendly guide with a face, on every Uzaa page from the first click.
// Built in (no AI service). It holds guided conversations (public/uzaa-flows.js) that ask clarifying
// questions and remember the answers, answers free questions from the how-to library
// (lib/assistant-kb.js), and keeps the owner's personal setup checklist, ticking steps off as Uzaa
// sees them done. Its face reacts: it blinks, follows your finger or mouse, thinks while it looks,
// smiles when it finds the answer, looks sorry when it cannot, and dozes off when left alone.

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
  const ink = '#eaf5fc';
  return (
    <svg className={`uzface m-${mood}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="uzg" cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#2f86bd" /><stop offset="1" stopColor="#0b5c87" /></radialGradient>
      </defs>
      {/* antenna: the arrow from the Uzaa mark */}
      <path className="uz-ant" d="M50 3 L58 14 H54 V20 H46 V14 H42 Z" fill="#f5b82e" />
      <circle cx="50" cy="56" r="40" fill="url(#uzg)" />
      <circle cx="50" cy="56" r="40" fill="none" stroke="#08476a" strokeWidth="1.5" opacity=".35" />
      <circle cx="27" cy="64" r="6" fill="#ff8fa3" opacity={mood === 'happy' ? 0.55 : 0.25} />
      <circle cx="73" cy="64" r="6" fill="#ff8fa3" opacity={mood === 'happy' ? 0.55 : 0.25} />
      <path className="uz-brow" d={BROW_L[mood] || BROW_L.idle} style={{ d: `path('${BROW_L[mood] || BROW_L.idle}')` }} stroke={ink} strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <path className="uz-brow" d={BROW_R[mood] || BROW_R.idle} style={{ d: `path('${BROW_R[mood] || BROW_R.idle}')` }} stroke={ink} strokeWidth="3.2" fill="none" strokeLinecap="round" />
      {[35, 65].map((cx) => (
        <g key={cx} className="uz-eye" style={{ transform: `scaleY(${closed ? 0.08 : eyeSquash})`, transformOrigin: `${cx}px 46px` }}>
          <ellipse cx={cx} cy="46" rx="8.5" ry={mood === 'surprised' ? 11 : 9.5} fill="#fff" />
          <circle cx={cx + px} cy={46 + py} r={mood === 'surprised' ? 3.6 : 4.4} fill="#14181f" />
          <circle cx={cx + px + 1.6} cy={46 + py - 1.8} r="1.3" fill="#fff" />
        </g>
      ))}
      <path className="uz-mouth" d={MOUTH[mood] || MOUTH.idle} style={{ d: `path('${MOUTH[mood] || MOUTH.idle}')` }}
        stroke={ink} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"
        fill={mood === 'happy' || mood === 'surprised' ? '#7a1f2b' : 'none'} />
      {mood === 'thinking' && <g className="uz-dots" fill="#2f86bd"><circle cx="78" cy="22" r="3" /><circle cx="86" cy="14" r="4" /></g>}
      {mood === 'sleep' && <text x="74" y="24" fontSize="14" fontWeight="800" fill="#0b5c87" fontFamily="system-ui">z</text>}
    </svg>
  );
}

const ROLE_WORD = { owner: 'owner', manager: 'manager', cashier: 'cashier', super_admin: 'Uzaa admin', sales: 'sales agent', visitor: 'guest' };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const SETUP_WORDS = /\b(set ?up|setup|get started|getting started|start|begin|checklist|onboard(ing)?|next step|what next|what now)\b/i;

/** The personal setup checklist. */
function PlanCard({ answers, progress, marked, onMark, signedIn, path, onGo }) {
  const items = planItems(answers, progress, marked);
  const done = items.filter((i) => i.done).length;
  return (
    <div className="ua-msg bot ua-plan">
      <b>Your setup plan</b>
      <div className="ua-prog" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
        <i style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
      </div>
      <div className="small muted" style={{ marginBottom: 6 }}>{done} of {items.length} done{signedIn ? '' : ' · you do these after you sign in'}</div>
      <ol>
        {items.map((it) => (
          <li key={it.id} className={it.done ? 'done' : ''}>
            <span className="ua-tick" aria-hidden="true">{it.done ? '✓' : ''}</span>
            <div>
              <div className="ua-ptitle">{it.title}</div>
              {!it.done && <div className="small muted">{it.why}</div>}
              {!it.done && signedIn && (
                <div className="ua-pact">
                  {path !== it.href && <Link href={it.href} onClick={onGo}>Go there &rarr;</Link>}
                  {it.manual && <button type="button" className="linkbtn" onClick={() => onMark(it.id)}>Mark done</button>}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!signedIn && <Link className="ua-go" href="/login">Sign in to start &rarr;</Link>}
      {signedIn && done === items.length && <div className="small ok">All done. Your business is ready to sell!</div>}
    </div>
  );
}

/**
 * role: visitor | owner | manager | cashier | super_admin | sales
 * auto: { flow, key, open, bubble } what to start on its own (decided by AssistantHost)
 * ctx: extra context for the conversations, e.g. { agreement: { business, status } }
 * progress: what Uzaa can see is done (owners), or null
 */
export default function UzaaAssistant({ role = 'visitor', name, auto, ctx = {}, progress = null, businessId = '', nav = false, onOpen }) {
  const path = usePathname() || '/';
  const base = '/' + (path.split('/')[1] || '');
  const first = String(name || '').split(' ')[0];
  const signedIn = role !== 'visitor';
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [mood, setMood] = useState('idle');
  const [blink, setBlink] = useState(false);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [bubble, setBubble] = useState('');
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const [answers, setAnswers] = useState({});
  const [marked, setMarked] = useState({});
  const face = useRef(null);
  const list = useRef(null);
  const idle = useRef(Date.now());
  const moodTimer = useRef(null);
  const started = useRef('');

  const markKey = `uzaa_marked_${businessId || 'me'}`;
  useEffect(() => {
    setHidden(store.get('uzaa_bot_hidden', false) === true);
    setAnswers(store.get('uzaa_answers', {}));
    setMarked(store.get(markKey, {}));
  }, [markKey]);

  const feel = useCallback((m, ms = 2200) => {
    setMood(m);
    clearTimeout(moodTimer.current);
    if (ms) moodTimer.current = setTimeout(() => setMood('idle'), ms);
  }, []);

  const startFlow = useCallback((flow, node = 'start') => {
    if (!FLOWS[flow]?.[node]) return;
    setMsgs((m) => [...m, { type: 'node', flow, node }]);
    feel('happy');
  }, [feel]);

  // start on its own: open the first time, afterwards just say hello in a bubble
  useEffect(() => {
    if (!auto?.flow || started.current === auto.key) return;
    started.current = auto.key;
    const seen = store.get(`uzaa_auto_${auto.key}`, false);
    setMsgs([]);
    startFlow(auto.flow);
    if (auto.open && !seen && !store.get('uzaa_bot_hidden', false)) {
      store.set(`uzaa_auto_${auto.key}`, true);
      const t = setTimeout(() => { setOpen(true); onOpen?.(); }, 900);
      return () => clearTimeout(t);
    }
    if (auto.bubble) {
      const t1 = setTimeout(() => { setBubble(auto.bubble); feel('happy'); }, 1200);
      const t2 = setTimeout(() => setBubble(''), 9000);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [auto?.flow, auto?.key]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // other parts of the app can open the assistant on a topic: dispatchEvent(new CustomEvent('uzaa:assist', { detail: { flow } }))
  useEffect(() => {
    const h = (e) => {
      const d = e.detail || {};
      setHidden(false); setOpen(true); setBubble('');
      if (d.flow) startFlow(d.flow, d.node);
      if (d.plan) setMsgs((m) => [...m, { type: 'plan' }]);
    };
    window.addEventListener('uzaa:assist', h);
    return () => window.removeEventListener('uzaa:assist', h);
  }, [startFlow]);

  // keep the newest message in view; a new checklist is shown from its top
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const plans = el.querySelectorAll('.ua-plan');
    if (msgs[msgs.length - 1]?.type === 'plan' && plans.length) el.scrollTop = plans[plans.length - 1].offsetTop - 8;
    else el.scrollTop = el.scrollHeight;
  }, [msgs, open]);

  const lastNode = useMemo(() => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].type === 'node') return i; return -1; }, [msgs]);
  const talkCtx = { name: first, answers, ...ctx };

  function choose(opt, i) {
    idle.current = Date.now();
    const add = [];
    if (!opt.href) add.push({ type: 'me', text: opt.label });
    if (opt.set) {
      const next = { ...answers, ...opt.set };
      setAnswers(next); store.set('uzaa_answers', next);
    }
    // close the options on the message that was answered
    setMsgs((m) => m.map((x, j) => (j === i ? { ...x, chosen: opt.label } : x)));
    if (opt.next) add.push({ type: 'node', flow: msgs[i].flow, node: opt.next });
    if (opt.flow) add.push({ type: 'node', flow: opt.flow, node: 'start' });
    if (opt.topic) { const k = KB.find((x) => x.id === opt.topic); if (k) add.push({ type: 'card', card: k }); }
    if (opt.plan) add.push({ type: 'plan' });
    if (add.length) {
      setMsgs((m) => [...m, ...add.slice(0, 1), { type: 'typing' }]);
      feel('thinking', 0);
      setTimeout(() => { setMsgs((m) => [...m.filter((x) => x.type !== 'typing'), ...add.slice(1)]); feel('happy'); }, 450);
    }
  }

  function mark(id) {
    const next = { ...marked, [id]: true };
    setMarked(next); store.set(markKey, next);
    feel('happy');
  }

  function reply(k) {
    setMsgs((m) => [...m, { type: 'me', text: k.title }, { type: 'card', card: k }]);
    feel('happy');
  }

  function ask(e) {
    e?.preventDefault();
    const text = q.trim();
    if (!text) return;
    setQ('');
    idle.current = Date.now();
    setMsgs((m) => [...m, { type: 'me', text }, { type: 'typing' }]);
    feel('thinking', 0);
    setTimeout(() => {
      const kbRole = signedIn ? role : 'visitor';
      const hits = answerScored(text, kbRole);
      const greet = /^(hi|hello|hey|habari|mambo|niaje|sasa|good (morning|afternoon|evening))\b/i.test(text);
      const thanks = /\b(thanks|thank you|asante|great|nice|cool)\b/i.test(text);
      const setupAsk = SETUP_WORDS.test(text) && (!hits.length || hits[0].s < 6);
      let add = []; let m2 = 'happy';
      if (setupAsk && role === 'owner') add = [{ type: 'node', flow: 'setup', node: 'start' }];
      else if (setupAsk && !signedIn) add = [{ type: 'node', flow: 'visitor', node: 'start' }];
      else if (hits.length >= 2 && hits[0].s - hits[1].s < 1.5 && hits[0].s < 7) {
        // not sure which one they mean: ask
        add = [{ type: 'clarify', text: 'Just to be sure, which of these do you mean?', options: hits.slice(0, 4).map((h) => h.k) }];
        m2 = 'surprised';
      } else if (hits.length) {
        add = [{ type: 'card', card: hits[0].k }, ...(hits.length > 1 ? [{ type: 'clarify', text: 'Or did you mean:', options: hits.slice(1, 3).map((h) => h.k) }] : [])];
      } else if (greet) add = [{ type: 'bot', text: `Hello${first ? ` ${first}` : ''}! What would you like to do today?` }];
      else if (thanks) add = [{ type: 'bot', text: 'Karibu! I am right here if you need anything else.' }];
      else {
        add = [{ type: 'bot', text: 'Hmm, I am not sure about that one yet. Could you say it another way, for example "add stock", "print a receipt" or "add a cashier"? Or pick from the options below.' }];
        m2 = 'sorry';
      }
      setMsgs((m) => [...m.filter((x) => x.type !== 'typing'), ...add]);
      feel(m2, 2600);
    }, 600);
  }

  function toggle() {
    idle.current = Date.now();
    setBubble('');
    if (!open && msgs.length === 0) startFlow(auto?.flow || (signedIn ? 'none' : 'visitor'));
    setOpen((o) => !o);
    if (!open) onOpen?.();
    feel(open ? 'idle' : 'happy', 1600);
  }
  function hide() { store.set('uzaa_bot_hidden', true); setHidden(true); setOpen(false); }
  function unhide() { store.set('uzaa_bot_hidden', false); setHidden(false); feel('happy'); }

  // quick starts and suggestions for this screen
  const starts = [];
  if (role === 'owner') starts.push({ label: 'Set up my business', run: () => startFlow('setup') }, { label: 'My setup checklist', run: () => setMsgs((m) => [...m, { type: 'plan' }]) });
  if (!signedIn && base === '/agreement') {
    starts.push({ label: 'Help me sign', run: () => startFlow('agreementHelp') });
    starts.push({ label: 'What happens next?', run: () => startFlow('afterSign') });
  } else if (!signedIn) starts.push({ label: 'Start here', run: () => startFlow('visitor') });
  const tips = forRole(SUGGEST[base] || [], signedIn ? role : 'visitor');
  const general = forRole(['install', 'security', 'reports', 'sell', 'onboard', 'agentbiz', 'v-signup', 'v-signin'], signedIn ? role : 'visitor').filter((k) => !tips.includes(k));
  const chips = [...tips, ...general].slice(0, 5);

  if (hidden) {
    return <button type="button" className={`ua-peek no-print ${nav ? '' : 'nonav'}`} onClick={unhide} aria-label="Show Uzaa Assistant"><UzaaFace size={30} mood="idle" look={look} blink={blink} /></button>;
  }

  const renderNode = (m, i) => {
    const n = FLOWS[m.flow]?.[m.node];
    if (!n) return null;
    const say = typeof n.say === 'function' ? n.say(talkCtx) : n.say;
    const active = i === lastNode && !m.chosen;
    return (
      <div key={i} className="ua-msg bot">
        <div style={{ whiteSpace: 'pre-line' }}>{say}</div>
        {active && n.options.length > 0 && (
          <div className="ua-opts">
            {n.options.map((o) => (o.href
              ? (o.external || o.href.startsWith('http')
                ? <a key={o.label} href={o.href} target="_blank" rel="noopener noreferrer" onClick={() => choose(o, i)}>{o.label}</a>
                : <Link key={o.label} href={o.href} onClick={() => choose(o, i)}>{o.label}</Link>)
              : <button type="button" key={o.label} onClick={() => choose(o, i)}>{o.label}</button>))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`ua no-print ${base === '/pos' ? 'ua-pos' : ''} ${nav ? '' : 'nonav'}`}>
      {open && (
        <section className="ua-panel" role="dialog" aria-label="Uzaa Assistant">
          <header className="ua-head">
            <UzaaFace size={46} mood={mood} look={look} blink={blink} />
            <div className="grow" style={{ minWidth: 0 }}>
              <b>Uzaa Assistant</b>
              <div className="small" style={{ opacity: 0.85 }}>{mood === 'thinking' ? 'Thinking...' : signedIn ? `Helping you as ${ROLE_WORD[role] || 'a user'}` : 'Here to help you get started'}</div>
            </div>
            <button type="button" className="ua-x" onClick={hide} title="Hide the assistant">Hide</button>
            <button type="button" className="ua-x" onClick={toggle} aria-label="Close">&times;</button>
          </header>

          <div className="ua-msgs" ref={list} aria-live="polite">
            {msgs.length === 0 && <div className="ua-msg bot">Hi{first ? ` ${first}` : ''}! I&apos;m Uzaa, your guide. Ask me anything, or tap an option below.</div>}
            {msgs.map((m, i) => {
              if (m.type === 'node') return renderNode(m, i);
              if (m.type === 'typing') return <div key={i} className="ua-msg bot"><span className="ua-typing"><i /><i /><i /></span></div>;
              if (m.type === 'plan') return <PlanCard key={i} answers={answers} progress={progress} marked={marked} onMark={mark} signedIn={signedIn} path={base} onGo={() => feel('happy')} />;
              if (m.type === 'card') return (
                <div key={i} className="ua-msg bot ua-card">
                  <b>{m.card.title}</b>
                  <ol>{m.card.steps.map((s, j) => <li key={j}>{s}</li>)}</ol>
                  {m.card.href && base !== m.card.href && <Link className="ua-go" href={m.card.href} onClick={() => feel('happy')}>{m.card.go || 'Take me there'} &rarr;</Link>}
                </div>
              );
              if (m.type === 'clarify') return (
                <div key={i} className="ua-msg bot">
                  <span className="small">{m.text}</span>
                  <div className="ua-opts">
                    {m.options.map((k) => <button type="button" key={k.id} onClick={() => reply(k)}>{k.title}</button>)}
                    <button type="button" onClick={() => setMsgs((x) => [...x, { type: 'bot', text: 'No problem. Tell me in other words, and I will try again.' }])}>Something else</button>
                  </div>
                </div>
              );
              return <div key={i} className={`ua-msg ${m.type === 'me' ? 'me' : 'bot'}`}>{m.text}</div>;
            })}
          </div>

          <div className="ua-chips ua-sugg">
            {starts.map((s) => <button type="button" key={s.label} className="strong" onClick={s.run}>{s.label}</button>)}
            {chips.map((k) => <button type="button" key={k.id} onClick={() => reply(k)}>{k.title}</button>)}
          </div>
          <form className="ua-ask" onSubmit={ask}>
            <input className="input" value={q} onChange={(e) => { setQ(e.target.value); if (mood !== 'thinking') setMood(e.target.value ? 'surprised' : 'idle'); }}
              placeholder="Ask me anything about Uzaa" aria-label="Ask the Uzaa Assistant" maxLength={200} />
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
