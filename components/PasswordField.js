'use client';
import { useState } from 'react';
import { checks, LABELS, strength, STRENGTH_LABEL, MIN_LEN } from '@/lib/password-rules';

// Password box with show/hide, a live strength meter and the rules ticked off as they are met.
export default function PasswordField({ value, onChange, email = '', label = 'Password', autoComplete = 'new-password', meter = true, id = 'pw' }) {
  const [show, setShow] = useState(false);
  const s = strength(value, email);
  const c = checks(value, email);
  return (
    <div className="field">
      <label htmlFor={id} className="lab">{label}</label>
      <div className="pwbox">
        <input id={id} className="input" type={show ? 'text' : 'password'} required autoComplete={autoComplete} value={value}
          onChange={(e) => onChange(e.target.value)} minLength={meter ? MIN_LEN : undefined} maxLength={100} spellCheck={false} autoCapitalize="none" />
        <button type="button" className="btn small" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
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
  );
}
