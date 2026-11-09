'use client';
// "Download / print" on the public e-receipt: the phone's print dialog also saves as PDF.
export default function PrintPage({ className, style, children }) {
  return <button type="button" className={className} style={style} onClick={() => window.print()}>{children}</button>;
}
