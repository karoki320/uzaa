'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { fmtDate, isoDate, money } from '@/lib/util';
import Modal from '@/components/Modal';
import CountUp from '@/components/CountUp';

const EXPENSE_CATEGORIES = ['Rent', 'Salaries & wages', 'Electricity', 'Water', 'Internet & airtime', 'Delivery', 'Transport', 'Fuel'];
const FREQ = [['one-off', 'One-off'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];
const freqName = (k) => (FREQ.find((f) => f[0] === k) || FREQ[0])[1];

export default function Expenses() {
  const { business, branches, profile } = useAuth();
  const cur = business.currency;
  const isCashier = profile.role === 'cashier';
  const limit = Number(business.cashier_expense_limit ?? 2000);
  const cashierOff = isCashier && limit <= 0;
  const today = isoDate(new Date());
  const yesterday = isoDate(new Date(Date.now() - 864e5));
  const [month, setMonth] = useState(today.slice(0, 7));
  const [branchId, setBranchId] = useState('');
  const [rows, setRows] = useState([]);
  const [names, setNames] = useState({});
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);

  const payFrom = useMemo(() => {
    const m = (business.payment_methods || ['Cash']).filter((x) => x.toLowerCase() !== 'credit');
    return [...new Set([...m, 'Bank'])];
  }, [business.payment_methods]);

  const load = useCallback(async () => {
    const [y, m] = month.split('-').map(Number);
    const from = `${month}-01`;
    const to = isoDate(new Date(y, m, 1));
    let q = supabase.from('expenses').select('*').gte('spent_on', from).lt('spent_on', to)
      .order('spent_on', { ascending: false }).order('created_at', { ascending: false }).range(0, 1999);
    if (branchId) q = q.eq('branch_id', branchId);
    const { data, error } = await q;
    setMissing(!!error && /expenses/.test(error.message || ''));
    setRows(data || []);
  }, [month, branchId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (isCashier) return setNames({ [profile.id]: profile.full_name });
    supabase.from('profiles').select('id,full_name').then(({ data }) => {
      const m = {};
      (data || []).forEach((p) => (m[p.id] = p.full_name));
      setNames(m);
    });
  }, [isCashier, profile]);

  const cats = useMemo(() => [...new Set([...EXPENSE_CATEGORIES, ...rows.map((r) => r.category)])], [rows]);
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const waiting = rows.filter((r) => !r.reviewed);
  const byCat = useMemo(() => {
    const m = {};
    rows.forEach((r) => { m[r.category] = (m[r.category] || 0) + Number(r.amount); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const byFreq = useMemo(() => FREQ.map(([k, l]) => ({ k, l, v: rows.filter((r) => r.frequency === k).reduce((s, r) => s + Number(r.amount), 0) })), [rows]);
  const shown = onlyOpen ? waiting : rows;

  function start() {
    setErr('');
    setEdit({ amount: '', category: '', other: '', frequency: 'one-off', paid_from: payFrom[0] || 'Cash', spent_on: today, branch_id: profile.branch_id || branches[0]?.id || '', note: '' });
  }

  async function save(e) {
    e.preventDefault();
    setErr('');
    const amount = Number(edit.amount);
    const category = (edit.category === '__other' ? edit.other : edit.category).trim();
    if (!(amount > 0)) return setErr('Enter the amount');
    if (!category) return setErr('Choose what the money was spent on');
    if (isCashier && amount > limit) return setErr(`Cashiers can record up to ${money(limit, cur)}. Ask the owner or a manager for this one.`);
    setBusy(true);
    const payload = {
      amount, category: category.slice(0, 60), frequency: edit.frequency, paid_from: edit.paid_from,
      spent_on: edit.spent_on, note: edit.note.trim().slice(0, 300), branch_id: isCashier ? profile.branch_id : edit.branch_id || null,
    };
    const { error } = edit.id
      ? await supabase.from('expenses').update(payload).eq('id', edit.id)
      : await supabase.from('expenses').insert({ ...payload, business_id: business.id, user_id: profile.id });
    setBusy(false);
    if (error) return setErr(error.message);
    setEdit(null);
    if (edit.spent_on.slice(0, 7) !== month) setMonth(edit.spent_on.slice(0, 7)); else load();
  }

  async function check(r) {
    setRows((l) => l.map((x) => (x.id === r.id ? { ...x, reviewed: true } : x)));
    const { error } = await supabase.from('expenses').update({ reviewed: true }).eq('id', r.id);
    if (error) { setErr(error.message); load(); }
  }
  async function remove(r) {
    const { error } = await supabase.from('expenses').delete().eq('id', r.id);
    if (error) return setErr(error.message);
    setRows((l) => l.filter((x) => x.id !== r.id));
  }

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  const max = Math.max(1, ...byCat.map((c) => c[1]));
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });

  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div><h1>{isCashier ? 'My expenses' : 'Expenses'}</h1><div className="muted small">{monthLabel}</div></div>
        <div className="row">
          <input className="input" type="month" style={{ width: 170 }} value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
          {!isCashier && branches.length > 1 && (
            <select className="input" style={{ width: 190 }} value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {!cashierOff && <button className="btn primary" onClick={start} disabled={missing}>Add expense</button>}
        </div>
      </div>

      {missing && <div className="err">Expenses are not set up yet. Run supabase/security-patch-13.sql in Supabase.</div>}
      {cashierOff && <div className="tint">Your owner has not allowed cashiers to record expenses.</div>}
      {isCashier && !cashierOff && (
        <p className="muted small">Record money paid out of the till, like delivery or fuel, up to {money(limit, cur)} each. The owner or a manager checks them.</p>
      )}
      {err && !edit && <div className="err" role="alert">{err}</div>}

      <section className="hero">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="k">Spent in {monthLabel}</div>
          <div className="big"><CountUp value={total} format={(v) => money(v, cur)} /></div>
          <p>{rows.length} expense{rows.length === 1 ? '' : 's'}{byCat[0] ? <>. Biggest: <b>{byCat[0][0]}</b>, {Math.round((byCat[0][1] / (total || 1)) * 100)}%</> : ''}</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <i style={{ height: 50, background: '#F4B892' }} /><i style={{ height: 32, background: '#F5CF86' }} /><i style={{ height: 22, background: '#A3A2D8' }} />
        </div>
      </section>

      {(byFreq.some((f) => f.v > 0) || waiting.length > 0) && (
        <div className="kpis">
          {byFreq.filter((f) => f.v > 0).map((f, i) => (
            <div className={`kpi ${['peach', 'ice', 'lav', 'teal'][i % 4]}`} key={f.k}><div className="l">{f.l}</div><div className="v">{money(f.v, cur)}</div><div className="s">{total ? Math.round((f.v / total) * 100) : 0}% of the month</div></div>
          ))}
          {waiting.length > 0 && (
            <button type="button" className="kpi amber" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => setOnlyOpen((v) => !v)}>
              <div className="l">{isCashier ? 'Not checked yet' : 'Waiting for you to check'}</div><div className="v">{waiting.length}</div>
              <div className="s">{onlyOpen ? 'Showing only these. Tap to show all.' : 'Tap to show only these'}</div>
            </button>
          )}
        </div>
      )}

      {byCat.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Where the money went</h3></div>
          {byCat.map(([name, v], i) => (
            <div className="lrow" key={name}>
              <span className="rank" style={{ background: ['var(--c-peach)', 'var(--c-amber)', 'var(--c-lav)', 'var(--c-ice)', 'var(--c-teal)'][i % 5] }}>{Math.round((v / (total || 1)) * 100)}%</span>
              <span className="grow2"><b style={{ fontSize: 14 }}>{name}</b><div className="lvl"><i style={{ width: `${(v / max) * 100}%`, background: ['#E08A55', '#E7AE3E', '#8B89C9', '#4E8FB5', '#4FA39C'][i % 5] }} /></div></span>
              <span className="amt">{money(v, cur)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-head"><h3>All expenses</h3>{onlyOpen && <button className="pill" onClick={() => setOnlyOpen(false)} style={{ cursor: 'pointer' }}>Show all</button>}</div>
        {shown.map((r) => (
          <div className="lrow" key={r.id} style={{ flexWrap: 'wrap' }}>
            <span className="rank" style={{ background: r.reviewed ? 'var(--c-pale)' : 'var(--c-amber)', fontSize: 11, lineHeight: 1.1, textAlign: 'center' }}>
              {new Date(`${r.spent_on}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric' })}<br />{new Date(`${r.spent_on}T00:00:00`).toLocaleDateString('en-KE', { month: 'short' })}
            </span>
            <span className="grow2">
              <b style={{ fontSize: 14 }}>{r.category} <span className="badge" style={{ fontSize: 11 }}>{freqName(r.frequency)}</span>{!r.reviewed && <span className="badge amber" style={{ fontSize: 11, marginLeft: 4 }}>not checked</span>}</b>
              <span>{r.paid_from}{r.note ? ` · ${r.note}` : ''}{!isCashier ? ` · ${names[r.user_id] || '-'}` : ''}{branches.length > 1 && r.branch_id ? ` · ${branches.find((b) => b.id === r.branch_id)?.name || ''}` : ''}</span>
            </span>
            <span className="amt">{money(r.amount, cur)}</span>
            <span style={{ display: 'flex', gap: 6, width: '100%', justifyContent: 'flex-end' }}>
              {!isCashier && !r.reviewed && <button className="btn small primary" onClick={() => check(r)}>Checked</button>}
              {!isCashier && <button className="btn small" onClick={() => { setErr(''); setEdit({ ...r, amount: String(r.amount), category: cats.includes(r.category) ? r.category : '__other', other: r.category }); }}>Edit</button>}
              {(!isCashier || !r.reviewed) && <button className="btn small danger" onClick={() => remove(r)}>Delete</button>}
            </span>
          </div>
        ))}
        {shown.length === 0 && <p className="muted" style={{ margin: 0 }}>No expenses in {monthLabel}.</p>}
      </div>

      {edit && (
        <Modal title={edit.id ? 'Edit expense' : 'Add expense'} onClose={() => setEdit(null)}>
          <form onSubmit={save}>
            <label className="field"><span>Amount ({cur})</span>
              <input className="input" required inputMode="decimal" autoFocus value={edit.amount} onChange={set('amount')} placeholder="0" />
            </label>
            <label className="field"><span>Spent on</span>
              <select className="input" required value={edit.category} onChange={set('category')}>
                <option value="" disabled>Choose...</option>
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="__other">Something else...</option>
              </select>
            </label>
            {edit.category === '__other' && (
              <label className="field"><span>What was it?</span><input className="input" required maxLength={60} value={edit.other} onChange={set('other')} placeholder="e.g. Security, Cleaning, County licence" /></label>
            )}
            <div className="field"><span>How often do you pay this?</span>
              <div className="chips" role="radiogroup" aria-label="How often">
                {FREQ.map(([k, l]) => (
                  <button type="button" key={k} role="radio" aria-checked={edit.frequency === k} className={edit.frequency === k ? 'on' : ''} onClick={() => setEdit({ ...edit, frequency: k })}>{l}</button>
                ))}
              </div>
            </div>
            <div className="row">
              <label className="field grow"><span>Paid from</span>
                <select className="input" value={edit.paid_from} onChange={set('paid_from')}>
                  {[...new Set([...payFrom, edit.paid_from])].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="field grow"><span>Date</span>
                <input className="input" type="date" required value={edit.spent_on} onChange={set('spent_on')} min={isCashier ? yesterday : undefined} max={today} />
              </label>
            </div>
            {!isCashier && branches.length > 1 && (
              <label className="field"><span>Branch</span>
                <select className="input" value={edit.branch_id || ''} onChange={set('branch_id')}>
                  <option value="">Whole business</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
            <label className="field"><span>Note (optional)</span>
              <input className="input" maxLength={300} value={edit.note} onChange={set('note')} placeholder="e.g. Boda to deliver to Kilimani" />
            </label>
            {err && <div className="err" role="alert">{err}</div>}
            <button className="btn primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Saving...' : 'Save expense'}</button>
          </form>
        </Modal>
      )}
    </>
  );
}
