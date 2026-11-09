import { NextResponse } from 'next/server';
import { agreementPdf, certificatePdf, fileName } from './agreement';

/** The right PDF for an agreement row. part: document (an uploaded original) or certificate; else the agreement. */
export function pdfResponse(a, part, download = false) {
  let buf; let name;
  if (a.kind === 'uploaded') {
    if (part === 'certificate') { buf = certificatePdf(a); name = fileName(a, '-signature-certificate'); }
    else { buf = Buffer.from(a.doc_pdf || '', 'base64'); name = a.doc_name || fileName(a); }
  } else {
    buf = agreementPdf(a); name = fileName(a, a.status === 'signed' ? '-signed' : '');
  }
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
