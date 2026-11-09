import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { adminClient, serverReady } from '@/lib/server';
import { hit } from '@/lib/ratelimit';
import { tokenOk, stamp, provider } from '@/lib/agreement';
import SignAgreement from '@/components/SignAgreement';
import Logo from '@/components/Logo';

export const dynamic = 'force-dynamic';

// The client's private signing page, opened from the link the Uzaa admin sends. No account needed.
async function load(token) {
  if (!serverReady() || !tokenOk(token)) return null;
  const h = await headers();
  const ip = (h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',')[0] || 'unknown').trim().slice(0, 64);
  if (await hit('agreementview', `ip:${ip}`, { limit: 120, window: 900 })) return { busy: true };
  const sb = adminClient();
  const { data: a } = await sb.from('agreements')
    .select('id,token,kind,ref,client_name,client_business,client_email,client_phone,terms,doc_name,doc_hash,status,sent_at,viewed_at,signed_at,signer_name,signer_title,created_at')
    .eq('token', token).maybeSingle();
  if (!a) return null;
  if (a.status === 'sent') {
    const now = new Date().toISOString();
    await sb.from('agreements').update({ status: 'viewed', viewed_at: now }).eq('id', a.id).eq('status', 'sent');
    a.status = 'viewed'; a.viewed_at = now;
  }
  return a;
}

export async function generateMetadata() {
  return { title: 'Service agreement · Uzaa', robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function AgreementPage({ params }) {
  const { token } = await params;
  const a = await load(token);
  if (a?.busy) return <main className="agr"><div className="agr-card"><p>Too many requests. Please try again in a few minutes.</p></div></main>;
  if (!a) notFound();
  const p = a.terms?.provider || provider();
  const base = `/api/agreement/${a.token}/pdf`;

  if (a.status === 'void') {
    return (
      <main className="agr"><div className="agr-card">
        <Logo height={28} />
        <h1>This link is no longer valid</h1>
        <p className="muted">This agreement was withdrawn or replaced. Please ask {p.name} for the current link.</p>
      </div></main>
    );
  }

  return (
    <main className="agr">
      <div className="agr-card">
        <div className="agr-top">
          <Logo height={28} />
          <span className="badge">{a.status === 'signed' ? 'Signed' : 'Ready to sign'}</span>
        </div>
        <p className="agr-prov">{p.name}</p>
        <h1>{a.kind === 'uploaded' ? 'Service agreement' : 'Software Service Agreement'}</h1>
        <p className="muted small" style={{ marginTop: 0 }}>Ref {a.ref} &middot; for {a.client_business || a.client_name}</p>

        {a.status === 'signed' ? (
          <div className="agr-done" role="status">
            <b>Signed by {a.signer_name}{a.signer_title ? `, ${a.signer_title}` : ''}</b>
            <div className="small">{stamp(a.signed_at)}. A copy is below. {p.name} will activate your Uzaa account shortly.</div>
          </div>
        ) : (
          <p className="small">
            Hello {String(a.client_name || '').split(' ')[0] || 'there'}, please read the agreement below. When you are ready, sign at the bottom
            with your finger or mouse. It takes about a minute.
          </p>
        )}

        <div className="agr-actions">
          {a.kind === 'uploaded' ? (
            <>
              <a className="btn primary" href={base} target="_blank" rel="noopener">Open the agreement (PDF)</a>
              {a.status === 'signed' && <a className="btn" href={`${base}?part=certificate&dl=1`}>Download signature certificate</a>}
            </>
          ) : (
            <a className="btn" href={`${base}?dl=1`}>{a.status === 'signed' ? 'Download signed copy (PDF)' : 'Download as PDF'}</a>
          )}
        </div>

        {a.kind === 'generated' && (
          <article className="agr-doc">
            {(a.terms?.content || []).map((b, i) => {
              if (b.t === 'h') return <h3 key={i}>{b.s}</h3>;
              if (b.t === 'li') return <p key={i} className="agr-li">{b.s}</p>;
              if (b.t === 'kv') return (
                <table key={i} className="agr-kv"><tbody>{b.rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
              );
              return <p key={i}>{b.s}</p>;
            })}
          </article>
        )}

        {a.status !== 'signed' && (
          <SignAgreement token={a.token} name={a.client_name} uploaded={a.kind === 'uploaded'} />
        )}

        <p className="agr-foot small muted">
          Document fingerprint (SHA-256): <span className="agr-hash">{a.doc_hash}</span>
        </p>
      </div>
    </main>
  );
}
