'use client';
import { useEffect } from 'react';

/** Tells the Uzaa Assistant what page it is on (for example the agreement and whether it is signed). */
export default function AssistantPage({ data }) {
  useEffect(() => {
    window.__uzaaPage = data;
    window.dispatchEvent(new CustomEvent('uzaa:page', { detail: data }));
    return () => { window.__uzaaPage = null; };
  }, [JSON.stringify(data)]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** A button that opens the assistant on a conversation. */
export function AskUzaa({ flow, plan, className = 'btn', children }) {
  return (
    <button type="button" className={className}
      onClick={() => window.dispatchEvent(new CustomEvent('uzaa:assist', { detail: { flow, plan } }))}>
      {children}
    </button>
  );
}
