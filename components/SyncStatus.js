'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { listQueue, removeSale, updateSale } from '@/lib/offline';
import { syncQueue } from '@/lib/sync';
import { money, fmtDate } from '@/lib/util';
import Modal from '@/components/Modal';

// Header chip: shows "Offline" and how many sales are waiting; opens the waiting list.
// Also runs the upload whenever the connection is back.
export default function SyncStatus() {
  const { session, offline: bootOffline, business, profile } = useAuth();
  const [q, setQ] = useState([]);
  const [online, setOnline] = useState(true);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const uid = session?.user?.id;

  const refresh = useCallback(async () => setQ(await listQueue()), []);

  const run = useCallback(async () => {
    if (!uid) return;
    setBusy(true);
    const r = await syncQueue(uid);
    setBusy(false);
    await refresh();
    if (r.state === 'signin') setMsg('Sign in again to upload your waiting sales.');
    else if (r.state === 'other') setMsg('Some waiting sales belong to another login. Sign in as that person to upload them.');
    else if (r.sent) { setMsg(`${r.sent} sale${r.sent > 1 ? 's' : ''} uploaded.`); setTimeout(() => setMsg(''), 5000); }
    else setMsg('');
    window.dispatchEvent(new Event('uzaa-synced'));
  }, [uid, refresh]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => { setOnline(true); run(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('uzaa-queue', refresh);
    refresh();
    run();
    // keep trying while something is waiting (a weak signal can look "online" but fail)
    const t = setInterval(() => { listQueue().then((l) => { if (l.some((s) => s.status !== 'failed') && navigator.onLine) run(); }); }, 30000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('uzaa-queue', refresh);
      clearInterval(t);
    };
  }, [run, refresh]);

  const waiting = q.filter((s) => s.status !== 'failed').length;
  const failed = q.length - waiting;
  const isOff = !online || bootOffline;
  if (!isOff && !q.length && !msg) return null;
  const cur = business?.currency;

  return (
    <>
      <button type="button" className={`syncchip ${isOff ? 'off' : ''} ${failed ? 'bad' : ''}`} onClick={() => { setOpen(true); refresh(); }} aria-label="Sync status">
        <span className="dot" aria-hidden="true" />
        {isOff ? 'Offline' : failed ? 'Needs attention' : busy ? 'Uploading' : 'Waiting'}
        {q.length > 0 && <b>{q.length}</b>}
      </button>
      {open && (
        <Modal title="Sales on this phone" onClose={() => setOpen(false)}>
          <p className="small muted" style={{ marginTop: 0 }}>
            {isOff ? 'No internet. Sales are saved here and upload by themselves when you are back online.' : 'These sales upload automatically.'}
          </p>
          {msg && <div className="tint" role="status" style={{ marginBottom: 8 }}>{msg}{/sign in/i.test(msg) && <div style={{ marginTop: 8 }}><a className="btn small primary" href="/login" style={{ textDecoration: 'none' }}>Sign in</a></div>}</div>}
          {q.length === 0 && <p className="muted">Nothing is waiting. All sales are uploaded.</p>}
          {q.map((s) => (
            <div key={s.id} className="pendrow">
              <div>
                <b>{s.local_no}</b> <span className="small muted">{fmtDate ? fmtDate(s.at) : s.at}</span>
                <div className="small">{s.items.length} item{s.items.length > 1 ? 's' : ''}, {s.method}{s.user_id !== uid ? ', other login' : ''}</div>
                {s.status === 'failed' && <div className="small err" style={{ margin: 0 }}>Not accepted: {s.error}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <b>{money(s.total, cur)}</b>
                {s.status === 'failed' && (
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
                    <button className="btn small" onClick={async () => { await updateSale({ ...s, status: 'queued', error: '' }); run(); }}>Retry</button>
                    {profile?.role !== 'cashier' && (
                      <button className="btn small" onClick={async () => { if (window.confirm('Discard this sale? It will not be recorded.')) { await removeSale(s.id); refresh(); } }}>Discard</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {waiting > 0 && !isOff && <button className="btn primary" style={{ width: '100%', marginTop: 12 }} disabled={busy} onClick={run}>{busy ? 'Uploading...' : 'Upload now'}</button>}
        </Modal>
      )}
    </>
  );
}
