// Uzaa Assistant for the public landing page (plain HTML, no React). It uses the same conversations as
// the app (uzaa-flows.js) and the same face, so a visitor meets the same guide from the very first click.
import { FLOWS, UZAA_WA } from './uzaa-flows.js';

const MOUTH = {
  idle: 'M36 66 Q50 76 64 66', happy: 'M32 62 Q50 84 68 62 Q50 70 32 62 Z', thinking: 'M40 69 Q50 67 60 69',
  surprised: 'M45 66 Q50 58 55 66 Q50 76 45 66 Z', sorry: 'M38 72 Q50 63 62 72', sleep: 'M42 68 Q50 72 58 68',
};
const BL = { idle: 'M28 33 Q35 29 42 33', happy: 'M28 31 Q35 26 42 31', thinking: 'M28 30 Q35 27 42 32', surprised: 'M28 27 Q35 21 42 27', sorry: 'M28 30 Q35 33 42 34', sleep: 'M28 35 Q35 34 42 35' };
const BR = { idle: 'M58 33 Q65 29 72 33', happy: 'M58 31 Q65 26 72 31', thinking: 'M58 34 Q65 31 72 34', surprised: 'M58 27 Q65 21 72 27', sorry: 'M58 34 Q65 33 72 30', sleep: 'M58 35 Q65 34 72 35' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function face(size) {
  return `<svg class="uza-face" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
    <defs><radialGradient id="uzag2" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#2f86bd"/><stop offset="1" stop-color="#0b5c87"/></radialGradient></defs>
    <path class="uza-ant" d="M50 3 L58 14 H54 V20 H46 V14 H42 Z" fill="#f5b82e"/>
    <circle cx="50" cy="56" r="40" fill="url(#uzag2)"/>
    <circle class="uza-cheek" cx="27" cy="64" r="6" fill="#ff8fa3" opacity=".25"/><circle class="uza-cheek" cx="73" cy="64" r="6" fill="#ff8fa3" opacity=".25"/>
    <path class="uza-bl" d="${BL.idle}" stroke="#eaf5fc" stroke-width="3.2" fill="none" stroke-linecap="round"/>
    <path class="uza-br" d="${BR.idle}" stroke="#eaf5fc" stroke-width="3.2" fill="none" stroke-linecap="round"/>
    <g class="uza-eye" style="transform-origin:35px 46px"><ellipse cx="35" cy="46" rx="8.5" ry="9.5" fill="#fff"/><circle class="uza-pupil" cx="35" cy="46" r="4.4" fill="#14181f"/></g>
    <g class="uza-eye" style="transform-origin:65px 46px"><ellipse cx="65" cy="46" rx="8.5" ry="9.5" fill="#fff"/><circle class="uza-pupil" cx="65" cy="46" r="4.4" fill="#14181f"/></g>
    <path class="uza-mouth" d="${MOUTH.idle}" stroke="#eaf5fc" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

const CSS = `
.uza{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:9999;display:flex;flex-direction:column;align-items:flex-end;gap:10px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#14181f}
.uza button{font:inherit}
.uza-fab{width:70px;height:70px;border:0;padding:0;background:transparent;cursor:pointer;filter:drop-shadow(0 6px 14px rgba(11,92,135,.35));animation:uza-bob 3.2s ease-in-out infinite}
.uza-fab.hop{animation:uza-hop .6s ease}
@keyframes uza-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes uza-hop{0%{transform:translateY(0)}40%{transform:translateY(-10px) scale(1.06)}100%{transform:none}}
.uza-face path,.uza-face .uza-eye{transition:d .25s ease,transform .12s ease}
.uza-face .uza-pupil{transition:cx .15s ease,cy .15s ease}
.uza-ant{transform-origin:50px 20px;animation:uza-ant 4s ease-in-out infinite}
@keyframes uza-ant{0%,100%{transform:rotate(0)}50%{transform:rotate(-10deg)}}
.uza-bubble{max-width:240px;background:#fffdf6;border:1px solid #e9e2d0;border-radius:16px 16px 4px 16px;padding:10px 14px;font-size:14px;font-weight:600;box-shadow:0 6px 18px rgba(20,24,31,.12);cursor:pointer;text-align:left;color:#14181f}
.uza-panel{width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 120px));background:#fffdf6;border:1px solid #e9e2d0;border-radius:20px;box-shadow:0 18px 50px rgba(20,24,31,.22);display:flex;flex-direction:column;overflow:hidden}
.uza-head{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#0b5c87;color:#fff}
.uza-head .uza-face{background:#fff;border-radius:50%;flex:none}
.uza-head b{display:block}.uza-head small{opacity:.85}
.uza-x{margin-left:auto;background:rgba(255,255,255,.15);border:0;color:#fff;font-weight:700;border-radius:10px;min-height:34px;min-width:34px;cursor:pointer;font-size:18px}
.uza-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#fcf9f0}
.uza-msg{max-width:88%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-line}
.uza-msg.bot{align-self:flex-start;background:#fffdf6;border:1px solid #e9e2d0;border-bottom-left-radius:4px}
.uza-msg.me{align-self:flex-end;background:#0b5c87;color:#fff;border-bottom-right-radius:4px}
.uza-opts{display:flex;flex-direction:column;gap:6px;margin-top:8px;white-space:normal}
.uza-opts button,.uza-opts a{text-align:left;border:1px solid #0b5c87;background:#fffdf6;color:#0b5c87;border-radius:12px;padding:8px 12px;font-size:14px;font-weight:700;cursor:pointer;text-decoration:none;min-height:40px;display:flex;align-items:center}
.uza-opts button:hover,.uza-opts a:hover{background:#e2f1fb}
.uza-ask{display:flex;gap:8px;padding:8px 12px 12px;border-top:1px solid #e9e2d0}
.uza-ask input{flex:1;min-width:0;min-height:44px;padding:8px 12px;border:1px solid #e9e2d0;border-radius:14px;font:inherit;background:#fffdf6}
.uza-ask button{min-height:44px;padding:0 16px;border:0;border-radius:14px;background:#0b5c87;color:#fff;font-weight:700;cursor:pointer}
.uza-typing{display:inline-flex;gap:4px}.uza-typing i{width:7px;height:7px;border-radius:50%;background:#5b6472;animation:uza-dot .6s ease-in-out infinite alternate}
.uza-typing i:nth-child(2){animation-delay:.2s}.uza-typing i:nth-child(3){animation-delay:.4s}
@keyframes uza-dot{from{opacity:.3}to{opacity:1}}
@media (max-width:600px){.uza-fab{width:58px;height:58px}.uza-fab .uza-face{width:50px;height:50px}}
@media (prefers-reduced-motion:reduce){.uza-fab,.uza-ant{animation:none!important}}
@media print{.uza{display:none!important}}`;

// A typed question on the landing page: send it to the closest conversation.
const ROUTES = [
  [/price|cost|how much|quote|fee|pay(ment)?|subscription/i, 'visitor', 'price'],
  [/agreement|contract|sign(ature)?\b/i, 'agreementHelp', 'start'],
  [/forgot|reset|password/i, 'visitor', 'forgot'],
  [/log ?in|sign ?in|account/i, 'visitor', 'existing'],
  [/sign ?up|register|start|begin|join|create/i, 'visitor', 'newType'],
  [/need|hardware|printer|scanner|phone|computer|internet|offline/i, 'visitor', 'needs'],
  [/demo|feature|what is|how does|about/i, 'visitor', 'tour'],
];

function init() {
  if (document.querySelector('.uza')) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const root = document.createElement('div'); root.className = 'uza';
  root.innerHTML = `<div class="uza-panel" role="dialog" aria-label="Uzaa Assistant" hidden>
      <div class="uza-head">${face(46)}<div><b>Uzaa Assistant</b><small>Here to help you get started</small></div><button type="button" class="uza-x" aria-label="Close">&times;</button></div>
      <div class="uza-msgs" aria-live="polite"></div>
      <form class="uza-ask"><input placeholder="Ask me anything about Uzaa" aria-label="Ask the Uzaa Assistant" maxlength="200"><button>Ask</button></form>
    </div>
    <button type="button" class="uza-bubble" hidden></button>
    <button type="button" class="uza-fab" aria-label="Open Uzaa Assistant" aria-expanded="false">${face(58)}</button>`;
  document.body.appendChild(root);

  const panel = root.querySelector('.uza-panel'); const msgs = root.querySelector('.uza-msgs');
  const fab = root.querySelector('.uza-fab'); const bubble = root.querySelector('.uza-bubble');
  const form = root.querySelector('.uza-ask'); const input = form.querySelector('input');
  let answers = store.get('uzaa_answers', {});
  let moodT;

  function mood(m, ms = 2200) {
    root.querySelectorAll('.uza-face').forEach((f) => {
      f.querySelector('.uza-mouth').setAttribute('d', MOUTH[m]); f.querySelector('.uza-mouth').style.d = `path('${MOUTH[m]}')`;
      f.querySelector('.uza-mouth').setAttribute('fill', m === 'happy' || m === 'surprised' ? '#7a1f2b' : 'none');
      f.querySelector('.uza-bl').setAttribute('d', BL[m]); f.querySelector('.uza-bl').style.d = `path('${BL[m]}')`;
      f.querySelector('.uza-br').setAttribute('d', BR[m]); f.querySelector('.uza-br').style.d = `path('${BR[m]}')`;
      f.querySelectorAll('.uza-eye').forEach((e) => { e.style.transform = m === 'happy' ? 'scaleY(.55)' : m === 'sleep' ? 'scaleY(.08)' : ''; });
      f.querySelectorAll('.uza-cheek').forEach((c) => c.setAttribute('opacity', m === 'happy' ? '.55' : '.25'));
    });
    if (m === 'happy') { fab.classList.remove('hop'); void fab.offsetWidth; fab.classList.add('hop'); }
    clearTimeout(moodT); if (ms) moodT = setTimeout(() => mood('idle', 0), ms);
  }
  // blink and look around
  setInterval(() => {
    root.querySelectorAll('.uza-eye').forEach((e) => { const t = e.style.transform; e.style.transform = 'scaleY(.08)'; setTimeout(() => { e.style.transform = t; }, 140); });
  }, 4200);
  addEventListener('pointermove', (e) => {
    const r = fab.getBoundingClientRect(); const dx = e.clientX - (r.left + r.width / 2); const dy = e.clientY - (r.top + r.height / 2);
    const d = Math.max(1, Math.hypot(dx, dy)); const k = Math.min(1, d / 260);
    root.querySelectorAll('.uza-pupil').forEach((p, i) => { const cx = i % 2 ? 65 : 35; p.setAttribute('cx', cx + (dx / d) * k * 3.2); p.setAttribute('cy', 46 + (dy / d) * k * 2.6); });
  }, { passive: true });

  const scroll = () => { msgs.scrollTop = msgs.scrollHeight; };
  function say(html, cls = 'bot') { const d = document.createElement('div'); d.className = `uza-msg ${cls}`; d.innerHTML = html; msgs.appendChild(d); scroll(); return d; }
  function closeOpts() { msgs.querySelectorAll('.uza-opts').forEach((o) => o.remove()); }

  function node(flow, id) {
    const n = FLOWS[flow] && FLOWS[flow][id];
    if (!n) return;
    const text = typeof n.say === 'function' ? n.say({ answers }) : n.say;
    const d = say(esc(text));
    if (!n.options.length) return;
    const box = document.createElement('div'); box.className = 'uza-opts';
    for (const o of n.options) {
      // the checklist lives in the app: from here it means "sign in"
      const href = o.plan ? '/login' : o.href;
      const el = document.createElement(href ? 'a' : 'button');
      el.textContent = o.plan ? 'Sign in to see my setup plan' : o.label;
      if (href) { el.href = href; if (o.external || href.startsWith('http')) { el.target = '_blank'; el.rel = 'noopener noreferrer'; } } else el.type = 'button';
      el.addEventListener('click', () => {
        if (o.set) { answers = { ...answers, ...o.set }; store.set('uzaa_answers', answers); }
        if (href) return;
        closeOpts(); say(esc(o.label), 'me'); think(() => node(o.flow || flow, o.flow ? 'start' : o.next));
      });
      box.appendChild(el);
    }
    d.appendChild(box); scroll();
  }
  function think(then) {
    const t = say('<span class="uza-typing"><i></i><i></i><i></i></span>'); mood('thinking', 0);
    setTimeout(() => { t.remove(); then(); mood('happy'); }, 450);
  }

  function open(on) {
    panel.hidden = !on; bubble.hidden = true; fab.setAttribute('aria-expanded', String(on));
    if (on && !msgs.children.length) node('visitor', 'start');
    if (on) mood('happy', 1600);
  }
  fab.addEventListener('click', () => open(panel.hidden));
  bubble.addEventListener('click', () => open(true));
  root.querySelector('.uza-x').addEventListener('click', () => open(false));
  fab.addEventListener('mouseenter', () => mood('surprised', 900));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim(); if (!q) return; input.value = '';
    closeOpts(); say(esc(q), 'me');
    const hit = ROUTES.find(([re]) => re.test(q));
    think(() => {
      if (hit) node(hit[1], hit[2]);
      else {
        say(esc('I am not sure I understood. Are you new to Uzaa, already using it, or here to sign an agreement?'));
        node('visitor', 'start'); mood('sorry');
      }
    });
  });

  // From the very first visit: open and say hello once, then just wave with a bubble.
  if (store.get('uzaa_bot_hidden', false) === true) return;
  if (!store.get('uzaa_auto_visitor', false)) {
    store.set('uzaa_auto_visitor', true);
    setTimeout(() => open(true), 1200);
  } else {
    setTimeout(() => { bubble.textContent = 'Hi! New to Uzaa? I can help you get started.'; bubble.hidden = false; mood('happy'); }, 1500);
    setTimeout(() => { bubble.hidden = true; }, 9500);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
export { UZAA_WA };
