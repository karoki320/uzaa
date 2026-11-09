'use client';
import { useState } from 'react';
import { post } from '@/lib/api';
import { TYPE_PRESETS, fmtDate, waLink } from '@/lib/util';
import Modal from '@/components/Modal';

// Super admin: onboarding a client, sending a service agreement, and sharing the signing link.

export const AGR = {
  sent: { label: 'Sent, not opened', cls: 'amber' },
  viewed: { label: 'Opened, not signed', cls: 'amber' },
  signed: { label: 'Signed', cls: '' },
  void: { label: 'Cancelled', cls: 'red' },
};

const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const TERMS0 = { plan: 'Uzaa POS Standard', setup_fee: '', fee: '', period: 'month', start_date: '', term_months: 12, branches: 1, notice_days: 30, payment: '', special: '' };

// The last terms used are remembered on this device to save typing for the next client.
function savedTerms() {
  try { return { ...TERMS0, ...JSON.parse(localStorage.getItem('uzaa_agr_terms') || '{}'), start_date: today(), special: '' }; } catch { return { ...TERMS0, start_date: today() }; }
}
function rememberTerms(t) {
  try { const { special, start_date, ...rest } = t; localStorage.setItem('uzaa_agr_terms', JSON.stringify(rest)); } catch {}
}

const readFile = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = rej;
  r.readAsDataURL(file);
});

/** Choose how the agreement is made, and fill in its terms. */
function AgreementFields({ value, onChange, allowNone }) {
  const v = value; const set = (k) => (e) => onChange({ ...v, terms: { ...v.terms, [k]: e.target.value } });
  const [fileErr, setFileErr] = useState('');

  async function pick(e) {
    setFileErr('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return setFileErr('Choose a PDF file');
    if (file.size > 3 * 1024 * 1024) return setFileErr('That PDF is over 3 MB. Compress it first.');
    onChange({ ...v, pdf: await readFile(file), pdf_name: file.name });
  }

  return (
    <>
      <div className="seg" role="radiogroup" aria-label="Service agreement">
        {[['generate', 'Generate agreement'], ['upload', 'Upload my own PDF'], ...(allowNone ? [['none', 'Skip for now']] : [])].map(([k, l]) => (
          <button type="button" key={k} role="radio" aria-checked={v.mode === k} className={v.mode === k ? 'on' : ''} onClick={() => onChange({ ...v, mode: k })}>{l}</button>
        ))}
      </div>

      {v.mode === 'generate' && (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>Uzaa writes the agreement between The Biziirise Solutions and the client from these terms. The client reads it on their phone, signs with a finger, and you get the signed PDF.</p>
          <label className="field"><span>Plan name</span><input className="input" value={v.terms.plan} onChange={set('plan')} /></label>
          <div className="grid2">
            <label className="field"><span>Set-up fee (KES, once)</span><input className="input" inputMode="decimal" value={v.terms.setup_fee} onChange={set('setup_fee')} placeholder="0" /></label>
            <label className="field"><span>Subscription (KES)</span><input className="input" inputMode="decimal" required value={v.terms.fee} onChange={set('fee')} placeholder="1500" /></label>
            <label className="field"><span>Billed every</span>
              <select className="input" value={v.terms.period} onChange={set('period')}><option value="month">Month</option><option value="quarter">Quarter (3 months)</option><option value="year">Year</option></select>
            </label>
            <label className="field"><span>Start date</span><input className="input" type="date" value={v.terms.start_date} onChange={set('start_date')} /></label>
            <label className="field"><span>Minimum term (months)</span><input className="input" type="number" min="1" max="60" value={v.terms.term_months} onChange={set('term_months')} /></label>
            <label className="field"><span>Branches included</span><input className="input" type="number" min="1" max="100" value={v.terms.branches} onChange={set('branches')} /></label>
          </div>
          <label className="field"><span>How to pay</span><input className="input" value={v.terms.payment} onChange={set('payment')} placeholder="M-Pesa Paybill 000000, account: business name" /></label>
          <label className="field"><span>Notice period to end it (days)</span><input className="input" type="number" min="7" max="180" value={v.terms.notice_days} onChange={set('notice_days')} /></label>
          <label className="field"><span>Special terms for this client (optional, one per line)</span><textarea className="input" value={v.terms.special} onChange={set('special')} placeholder={'First month free\nTraining for 3 staff included'} /></label>
        </>
      )}

      {v.mode === 'upload' && (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>Upload an agreement you prepared yourself. The client opens it, then signs on the page. You get their signature certificate to keep with the PDF.</p>
          <label className="field"><span>Agreement PDF (up to 3 MB)</span><input className="input" type="file" accept="application/pdf,.pdf" onChange={pick} /></label>
          {v.pdf_name && <div className="small ok">Ready: {v.pdf_name}</div>}
          {fileErr && <div className="err">{fileErr}</div>}
        </>
      )}
    </>
  );
}

const agreementPayload = (v) => ({ mode: v.mode, terms: v.terms, pdf: v.pdf, pdf_name: v.pdf_name });
const checkAgreement = (v) => {
  if (v.mode === 'generate' && String(v.terms.fee).trim() === '') return 'Enter the subscription amount';
  if (v.mode === 'upload' && !v.pdf) return 'Choose the agreement PDF';
  return '';
};

/** Onboard a new client: details, then the agreement. */
export function OnboardClient({ onClose, onDone }) {
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ owner_name: '', name: '', owner_email: '', owner_phone: '', type: 'retail', branch: 'Main Branch', client_address: '', client_id_no: '' });
  const [agr, setAgr] = useState(() => ({ mode: 'generate', terms: savedTerms() }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (step === 1) return setStep(2);
    const bad = checkAgreement(agr);
    if (bad) return setErr(bad);
    setBusy(true);
    const r = await post('/api/admin/onboard', { ...f, agreement: agreementPayload(agr) });
    setBusy(false);
    if (!r.ok) return setErr(r.data.error || 'Could not onboard that client');
    if (agr.mode === 'generate') rememberTerms(agr.terms);
    onDone(r.data, f);
  }

  return (
    <Modal title={step === 1 ? 'Onboard a client · 1 of 2' : 'Service agreement · 2 of 2'} onClose={onClose}>
      <form onSubmit={submit}>
        {step === 1 ? (
          <>
            <label className="field"><span>Name of the proprietor</span><input className="input" required autoFocus value={f.owner_name} onChange={set('owner_name')} placeholder="Jane Mwangi" /></label>
            <label className="field"><span>Name of the business</span><input className="input" required value={f.name} onChange={set('name')} placeholder="Duka la Mama Njeri" /></label>
            <div className="grid2">
              <label className="field"><span>Email (their login invite goes here)</span><input className="input" type="email" required value={f.owner_email} onChange={set('owner_email')} /></label>
              <label className="field"><span>Phone (WhatsApp)</span><input className="input" type="tel" inputMode="tel" required value={f.owner_phone} onChange={set('owner_phone')} placeholder="0722 000 111" /></label>
              <label className="field"><span>Kind of business</span>
                <select className="input" value={f.type} onChange={set('type')}>
                  {Object.entries(TYPE_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <label className="field"><span>First branch</span><input className="input" value={f.branch} onChange={set('branch')} /></label>
              <label className="field"><span>Physical address (for the agreement)</span><input className="input" value={f.client_address} onChange={set('client_address')} placeholder="Shop 4, Moi Avenue, Nairobi" /></label>
              <label className="field"><span>ID no. / KRA PIN / Reg. no. (optional)</span><input className="input" value={f.client_id_no} onChange={set('client_id_no')} /></label>
            </div>
            <p className="muted small">The owner gets an email to choose a password. The business stays waiting until you activate it.</p>
          </>
        ) : (
          <AgreementFields value={agr} onChange={setAgr} allowNone />
        )}
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row" style={{ marginTop: 8 }}>
          {step === 2 && <button type="button" className="btn" onClick={() => setStep(1)}>Back</button>}
          <button className="btn primary grow" disabled={busy}>
            {step === 1 ? 'Next: agreement' : busy ? 'Setting up...' : agr.mode === 'none' ? 'Onboard without agreement' : 'Onboard and create agreement'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Send a (new) agreement to a business that is already on Uzaa. */
export function NewAgreement({ business, onClose, onDone }) {
  const [c, setC] = useState({ client_name: business.owner_name || '', client_email: business.owner_email || '', client_phone: business.owner_phone || '', client_address: '', client_id_no: '' });
  const [agr, setAgr] = useState(() => ({ mode: 'generate', terms: savedTerms() }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setC({ ...c, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const bad = checkAgreement(agr);
    if (bad) return setErr(bad);
    setBusy(true); setErr('');
    const r = await post('/api/admin/agreements', { business_id: business.id, client_business: business.name, ...c, agreement: agreementPayload(agr) });
    setBusy(false);
    if (!r.ok) return setErr(r.data.error || 'Could not create the agreement');
    if (agr.mode === 'generate') rememberTerms(agr.terms);
    onDone(r.data.agreement);
  }

  return (
    <Modal title={`Agreement for ${business.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="grid2">
          <label className="field"><span>Client (person signing)</span><input className="input" required value={c.client_name} onChange={set('client_name')} /></label>
          <label className="field"><span>Phone (WhatsApp)</span><input className="input" value={c.client_phone} onChange={set('client_phone')} /></label>
          <label className="field"><span>Email</span><input className="input" type="email" value={c.client_email} onChange={set('client_email')} /></label>
          <label className="field"><span>Physical address</span><input className="input" value={c.client_address} onChange={set('client_address')} /></label>
        </div>
        <label className="field"><span>ID no. / KRA PIN / Reg. no. (optional)</span><input className="input" value={c.client_id_no} onChange={set('client_id_no')} /></label>
        <AgreementFields value={agr} onChange={setAgr} />
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Creating...' : 'Create agreement'}</button>
      </form>
    </Modal>
  );
}

/** The signing link, ready to send by WhatsApp, email or copy. */
export function SendAgreement({ agreement: a, title, note, onClose }) {
  const [copied, setCopied] = useState(false);
  const first = String(a.client_name || '').split(' ')[0] || 'there';
  const msg = `Hello ${first}, welcome to Uzaa! Here is your service agreement for ${a.client_business || 'your business'} (ref ${a.ref}). Please read it and sign on your phone here: ${a.url}`;
  const wa = waLink(a.client_phone, msg);
  const mail = `mailto:${encodeURIComponent(a.client_email || '')}?subject=${encodeURIComponent(`Your Uzaa service agreement (${a.ref})`)}&body=${encodeURIComponent(`${msg}\n\nThank you,\nThe Biziirise Solutions`)}`;

  async function copy() {
    try { await navigator.clipboard.writeText(a.url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt('Copy this link', a.url); }
  }

  return (
    <Modal title={title || 'Send the agreement'} onClose={onClose}>
      {note && <div className="note small">{note}</div>}
      <p className="small" style={{ marginTop: 0 }}>Send this private link to <b>{a.client_name}</b>. They read and sign it on their phone. You will see it marked Signed here.</p>
      <div className="linkbox"><code>{a.url}</code></div>
      <div className="sendgrid">
        {wa ? <a className="btn primary" href={wa} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a> : <span className="small muted">Add a phone number to send on WhatsApp.</span>}
        <a className="btn" href={mail}>Send by email</a>
        <button type="button" className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        <a className="btn" href={`/api/admin/agreements/pdf?id=${a.id}`} target="_blank" rel="noopener">Preview PDF</a>
      </div>
    </Modal>
  );
}

/** Every agreement, with what to do next. */
export function AgreementList({ rows, err, onSend, onChanged, business }) {
  const [busy, setBusy] = useState('');
  async function act(a, action) {
    if (action === 'void' && !window.confirm(`Cancel agreement ${a.ref}? Its link stops working.`)) return;
    if (action === 'relink' && !window.confirm('Make a new link? The old link stops working.')) return;
    setBusy(a.id);
    const r = await fetch('/api/admin/agreements', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, action }) });
    const j = await r.json().catch(() => ({}));
    setBusy('');
    if (!r.ok) return alert(j.error || 'Could not save that');
    onChanged(j.agreement, action);
  }

  if (err) return <div className="note small">{err}</div>;
  if (!rows) return <div className="muted">Loading...</div>;
  const list = business ? rows.filter((r) => r.business_id === business) : rows;
  if (!list.length) return <div className="card muted">No agreements yet. Onboard a client, or use "Agreement" on a business, to send one.</div>;

  return (
    <div className="card">
      {list.map((a) => (
        <div key={a.id} className="agrrow">
          <div style={{ minWidth: 0 }}>
            <b>{a.client_business || a.client_name}</b> <span className="small muted">{a.ref}{a.kind === 'uploaded' ? ' · uploaded PDF' : ''}</span>
            <div className="small muted">{a.client_name}{a.client_phone ? ` · ${a.client_phone}` : ''}{a.client_email ? ` · ${a.client_email}` : ''}</div>
            <div className="small muted">
              Sent {fmtDate(a.sent_at)}{a.viewed_at ? ` · opened ${fmtDate(a.viewed_at)}` : ''}{a.signed_at ? ` · signed ${fmtDate(a.signed_at)} by ${a.signer_name}` : ''}
            </div>
          </div>
          <div className="agrrow-act">
            <span className={`badge ${AGR[a.status]?.cls || ''}`}>{AGR[a.status]?.label || a.status}</span>
            <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
              {a.status === 'signed' ? (
                <>
                  <a className="btn small" href={`/api/admin/agreements/pdf?id=${a.id}&dl=1`}>{a.kind === 'uploaded' ? 'Agreement PDF' : 'Signed PDF'}</a>
                  {a.kind === 'uploaded' && <a className="btn small" href={`/api/admin/agreements/pdf?id=${a.id}&part=certificate&dl=1`}>Certificate</a>}
                </>
              ) : a.status !== 'void' ? (
                <>
                  <button className="btn small primary" onClick={() => onSend(a)}>Send</button>
                  <button className="btn small" disabled={busy === a.id} onClick={() => act(a, 'relink')}>New link</button>
                  <button className="btn small danger" disabled={busy === a.id} onClick={() => act(a, 'void')}>Cancel</button>
                </>
              ) : (
                <button className="btn small" disabled={busy === a.id} onClick={() => act(a, 'relink')}>Re-send</button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
