'use client';
import { useEffect, useRef, useState } from 'react';
import { checks, LABELS, strength, STRENGTH_LABEL, MIN_LEN } from '@/lib/password-rules';

const Eye = ({ off }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
    {off && <path d="M3 3l18 18" />}
  </svg>
);

// Password box with show/hide (eye button), a live strength meter, the rules ticked off as they are met,
// and, with `confirm`, a second "type it again" box that must match before the form can be sent.
export default function PasswordField({
  value, onChange, email = '', label = 'Password', autoComplete = 'new-password', meter = true, id = 'pw',
  confirm = false, confirmLabel = 'Confirm password', maxLength = 100,
}) {
  const [show, setShow] = useState(false);
  const [again, setAgain] = useState('');
  const againRef = useRef(null);
  const s = strength(value, email);
  const c = checks(value, email);
  const match = again && again === value;

  // the browser itself refuses to send the form while the two do not match
  useEffect(() => {
    if (!confirm || !againRef.current) return;
    againRef.current.setCustomValidity(again && again !== value ? 'The two passwords do not match' : '');
  }, [confirm, again, value]);

  const toggle = (
    <button type="button" className="btn small pweye" onClick={() => setShow(!show)} aria-pressed={show}
      aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}>
      <Eye off={show} /><span>{show ? 'Hide' : 'Show'}</span>
    </button>
  );

  return (
    <>
      <div className="field">
        <label htmlFor={id} className="lab">{label}</label>
        <div className="pwbox">
          <input id={id} className="input" type={show ? 'text' : 'password'} required autoComplete={autoComplete} value={value}
            onChange={(e) => onChange(e.target.value)} minLength={meter ? MIN_LEN : undefined} maxLength={maxLength} spellCheck={false} autoCapitalize="none" />
          {toggle}
        </div>
        {meter && value && (
          <div aria-live="polite">
            <div className="meter" role="img" aria-label={`Password strength: ${STRENGTH_LABEL[s] || 'too short'}`}>
              {[1, 2, 3, 4].map((n) => <i key={n} className={s >= n ? `on s${s}` : ''} />)}
            </div>
            <div className="small muted">Strength: <b>{STRENGTH_LABEL[s] || 'Weak'}</b></div>
            <ul className="rules small">
              {Object.keys(c).map((k) => <li key={k} className={c[k] ? 'met' : ''}>{c[k] ? '✓' : '•'} {LABELS[k]}</li>)}
            </ul>
          </div>
        )}
      </div>
      {confirm && (
        <div className="field">
          <label htmlFor={`${id}-again`} className="lab">{confirmLabel}</label>
          <div className="pwbox">
            <input id={`${id}-again`} ref={againRef} className="input" type={show ? 'text' : 'password'} required autoComplete="new-password"
              value={again} onChange={(e) => setAgain(e.target.value)} maxLength={maxLength} spellCheck={false} autoCapitalize="none"
              aria-invalid={again && !match ? 'true' : undefined} />
            {toggle}
          </div>
          {again && (
            <div className={`small ${match ? 'ok' : 'err'}`} aria-live="polite" style={{ marginTop: 6 }}>
              {match ? '✓ Passwords match' : 'The passwords do not match yet'}
            </div>
          )}
        </div>
      )}
    </>
  );
}
