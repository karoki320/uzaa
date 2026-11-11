'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PRESETS, isoDate, money, num, rangeFor } from '@/lib/util';

// Colours for charts: chosen to stay apart in lightness, not only hue
const PALETTE = ['#4E8FB5', '#85C6C1', '#8B89C9', '#E7AE3E', '#9CCFE0', '#E08A55', '#2F6F93'];
const BAR_COLS = ['#9CCFE0', '#6FB3D2', '#85C6C1', '#2F6F93', '#5FA7C9', '#3B8AA8', '#6E6BB8'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BLOCKS = [6, 8, 10, 12, 14, 16, 18, 20];   // two-hour blocks, 6am to 10pm
const hourName = (h) => (h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`);

function pct(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}
function Chip({ cur, prev, suffix = 'vs before' }) {
  const p = pct(Number(cur) || 0, Number(prev) || 0);
  if (p === null) return <span className="chip">Nothing to compare yet</span>;
  if (p === 0) return <span className="chip">Same as before</span>;
  return <span className={`chip ${p > 0 ? 'up' : 'down'}`}>{p > 0 ? '▲' : '▼'} {Math.abs(p)}% {suffix}</span>;
}
const I = {
  trend: 'M4 17l5-5 4 4 7-8M15 8h5v5',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  coin: 'M12 3v18M17 7H9.5a3 3 0 000 6h5a3 3 0 010 6H6',
  spark: 'M12 2c2 4 6 6 6 11a6 6 0 01-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3 0-5 0-7z',
  out: 'M5 12h14M13 6l6 6-6 6',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  box: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
};
const Ico = ({ d }) => <span className="ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg></span>;

function Donut({ rows, size = 128 }) {
  const total = rows.reduce((s, r) => s + r.v, 0) || 1;
  const R = 44, C = 2 * Math.PI * R;
  let at = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={rows.map((r) => `${r.name} ${Math.round((r.v / total) * 100)}%`).join(', ')} style={{ flex: 'none', filter: 'drop-shadow(0 8px 12px rgba(27,52,74,0.25))' }}>
      <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="24" />
      {rows.map((r, i) => {
        const len = (r.v / total) * C;
        const el = <circle key={r.name} cx="60" cy="60" r={R} fill="none" stroke={r.c} strokeWidth="24" strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={-at} transform="rotate(-90 60 60)" />;
        at += len;
        return el;
      })}
      <circle cx="60" cy="60" r="30" fill="rgba(255,255,255,0.55)" />
    </svg>
  );
}

function Ranked({ title, rows, cur, qty, unit = 'sales', empty = 'No data yet' }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.revenue)));
  return (
    <div className="card">
      <div className="card-head"><h3>{title}</h3></div>
      {rows.length === 0 && <p className="muted small" style={{ margin: 0 }}>{empty}</p>}
      {rows.map((r, i) => (
        <div className="lrow" key={r.name}>
          <span className="rank" style={{ background: [ 'var(--c-teal)', 'var(--c-ice)', 'var(--c-lav)' ][i % 3] }}>{i + 1}</span>
          <div className="grow2">
            <b style={{ fontSize: 14 }}>{r.name}</b>
            <span>{qty ? `${num(r.qty)} sold` : `${r.count} ${unit}`}</span>
            <div className="lvl"><i style={{ width: `${(Number(r.revenue) / max) * 100}%`, background: PALETTE[i % PALETTE.length] }} /></div>
          </div>
          <span className="amt">{money(r.revenue, cur)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Reports() {
  const { business, branches } = useAuth();
  const cur = business.currency;
  const [preset, setPreset] = useState('thisweek');
  const [branchId, setBranchId] = useState('');
  const [data, setData] = useState(null);
  const [prev, setPrev] = useState(null);
  const [low, setLow] = useState([]);
  const [noCost, setNoCost] = useState(0);
  const [err, setErr] = useState('');
  const [exp, setExp] = useState(null);     // { total, prev, byCat } expenses for the period and the one before
  const [times, setTimes] = useState([]);   // each sale's time and total, for the busy-hours chart

  const range = useMemo(() => rangeFor(preset), [preset]);
  const oneDay = range.to - range.from <= 864e5 + 3.6e6;

  useEffect(() => {
    let off = false;
    setData(null);
    const len = range.to - range.from;
    const pf = new Date(range.from - len);
    const args = (f, t) => ({ p_from: f.toISOString(), p_to: t.toISOString(), p_branch: branchId || null });
    let s = supabase.from('sales').select('created_at,total').gte('created_at', range.from.toISOString()).lt('created_at', range.to.toISOString()).range(0, 4999);
    if (branchId) s = s.eq('branch_id', branchId);
    Promise.all([supabase.rpc('weekly_report', args(range.from, range.to)), supabase.rpc('weekly_report', args(pf, range.from)), s]).then(([a, b, c]) => {
      if (off) return;
      if (a.error) return setErr(a.error.message);
      setErr('');
      setData(a.data);
      setPrev(b.data);
      setTimes(c.data || []);
    });
    return () => { off = true; };
  }, [range, branchId]);

  // expenses: what was spent in the period, so profit can show what the business really keeps
  useEffect(() => {
    let off = false;
    const len = range.to - range.from;
    const pf = new Date(range.from - len);
    const q = (f, t) => {
      let x = supabase.from('expenses').select('amount,category').gte('spent_on', isoDate(f)).lt('spent_on', isoDate(t)).range(0, 4999);
      if (branchId) x = x.eq('branch_id', branchId);
      return x;
    };
    Promise.all([q(range.from, range.to), q(pf, range.from)]).then(([a, b]) => {
      if (off) return;
      if (a.error) return setExp(null);          // patch 13 not run yet
      const m = {};
      (a.data || []).forEach((e) => { m[e.category] = (m[e.category] || 0) + Number(e.amount); });
      setExp({
        total: (a.data || []).reduce((s, e) => s + Number(e.amount), 0),
        prev: (b.data || []).reduce((s, e) => s + Number(e.amount), 0),
        byCat: Object.entries(m).sort((x, y) => y[1] - x[1]).map(([name, revenue]) => ({ name, revenue, count: (a.data || []).filter((e) => e.category === name).length })),
      });
    });
    return () => { off = true; };
  }, [range, branchId]);

  useEffect(() => {
    (async () => {
      const [p, s] = await Promise.all([
        supabase.from('products').select('id,name,low_stock_level,cost,track_stock').eq('active', true).range(0, 4999),
        branchId
          ? supabase.from('stock').select('product_id,branch_id,qty').eq('branch_id', branchId).range(0, 9999)
          : supabase.from('stock').select('product_id,branch_id,qty').range(0, 9999),
      ]);
      const tot = {};
      (s.data || []).forEach((x) => (tot[x.product_id] = (tot[x.product_id] || 0) + Number(x.qty)));
      const list = p.data || [];
      setNoCost(list.filter((x) => !(Number(x.cost) > 0)).length);
      setLow(list.filter((x) => x.track_stock).map((x) => ({ ...x, qty: tot[x.id] || 0 })).filter((x) => x.qty <= Number(x.low_stock_level)).sort((a, b) => a.qty - b.qty));
    })();
  }, [branchId]);

  // revenue per day, or per hour when the period is a single day
  const bars = useMemo(() => {
    if (!data) return [];
    if (oneDay) {
      const m = {};
      times.forEach((t) => { const h = new Date(t.created_at).getHours(); m[h] = (m[h] || 0) + Number(t.total); });
      const out = [];
      for (let h = 7; h <= 21; h += 2) out.push({ k: h, label: hourName(h), v: (m[h] || 0) + (m[h + 1] || 0) });
      return out;
    }
    const map = {};
    (data.by_day || []).forEach((d) => (map[d.day] = Number(d.revenue)));
    const out = [];
    for (let d = new Date(range.from); d < range.to; d.setDate(d.getDate() + 1)) {
      const k = isoDate(d);
      const many = (range.to - range.from) / 864e5 > 10;
      out.push({ k, label: many ? String(d.getDate()) : d.toLocaleDateString('en-KE', { weekday: 'short' }), v: map[k] || 0 });
    }
    return out;
  }, [data, range, oneDay, times]);
  const barMax = Math.max(1, ...bars.map((b) => b.v));
  const best = bars.reduce((a, b) => (b.v > (a?.v || 0) ? b : a), null);

  // busiest times: weekday by two-hour block
  const heat = useMemo(() => {
    const g = DAYS.map(() => BLOCKS.map(() => 0));
    times.forEach((t) => {
      const d = new Date(t.created_at);
      const b = BLOCKS.findIndex((h) => d.getHours() >= h && d.getHours() < h + 2);
      if (b >= 0) g[(d.getDay() + 6) % 7][b] += 1;
    });
    let top = null;
    g.forEach((row, i) => row.forEach((v, j) => { if (v > 0 && (!top || v > top.v)) top = { v, day: DAYS[i], h: BLOCKS[j] }; }));
    return { g, max: Math.max(1, ...g.flat()), top };
  }, [times]);

  const t = data?.totals;
  const pt = prev?.totals;
  const revenue = Number(t?.revenue || 0);
  const gross = Number(data?.profit || 0);
  const net = exp ? gross - exp.total : gross;
  const prevNet = exp ? Number(prev?.profit || 0) - exp.prev : Number(prev?.profit || 0);
  const pays = (data?.by_payment || []).map((r, i) => ({ name: r.name, v: Number(r.revenue), c: PALETTE[i % PALETTE.length] }));
  const payTotal = pays.reduce((s, r) => s + r.v, 0);
  const hr = new Date().getHours();
  const hello = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const label = PRESETS.find((p) => p.key === preset)?.label.toLowerCase() || '';
  const rp = pct(revenue, Number(pt?.revenue || 0));

  return (
    <>
      <div className="row between no-print" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Reports</h1>
        <div className="row" style={{ gap: 8 }}>
          {branches.length > 1 && (
            <select className="input" style={{ width: 180, minHeight: 44 }} value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button className="round" aria-label="Print report" onClick={() => { document.body.classList.add('print-report'); window.print(); setTimeout(() => document.body.classList.remove('print-report'), 500); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z" /></svg>
          </button>
        </div>
      </div>
      <div className="segs no-print" role="tablist" aria-label="Period">
        {PRESETS.map((p) => <button key={p.key} role="tab" aria-selected={preset === p.key} className={preset === p.key ? 'on' : ''} onClick={() => setPreset(p.key)}>{p.label}</button>)}
      </div>

      <div className="receipt-print">
        {err && <div className="err">{err}</div>}
        {!data && !err && <div className="muted">Loading...</div>}
        {data && (
          <>
            <section className="hero">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="k">{hello},</div>
                <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.25 }}>{business.name}</div>
                <p>
                  You made <b>{money(revenue, cur)}</b> {label}
                  {rp === null ? '.' : rp === 0 ? ', the same as before.' : `, ${Math.abs(rp)}% ${rp > 0 ? 'more' : 'less'} than the period before.`}
                </p>
                <p style={{ fontSize: 12 }}>{range.from.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })} – {new Date(range.to - 1).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                <Link href="/sales" className="btn primary no-print" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>Today's sales
                </Link>
              </div>
              <div className="hero-art" aria-hidden="true">
                <i style={{ height: 30, background: '#85C6C1' }} /><i style={{ height: 56, background: '#4E8FB5' }} /><i style={{ height: 42, background: '#8B89C9' }} />
              </div>
            </section>

            <div className="kpis">
              <div className="kpi teal"><Ico d={I.trend} /><div className="l">Revenue</div><div className="v">{money(revenue, cur)}</div><Chip cur={revenue} prev={pt?.revenue} /></div>
              <div className="kpi ice"><Ico d={I.receipt} /><div className="l">Sales</div><div className="v">{t.count}</div><Chip cur={t.count} prev={pt?.count} /></div>
              <div className="kpi"><Ico d={I.coin} /><div className="l">Average sale</div><div className="v">{t.count ? money(revenue / t.count, cur) : '-'}</div><Chip cur={t.count ? revenue / t.count : 0} prev={pt?.count ? Number(pt.revenue) / pt.count : 0} /></div>
              <div className="kpi lav"><Ico d={I.spark} /><div className="l">{exp ? 'Net profit (you keep)' : 'Profit'}</div><div className="v">{money(net, cur)}</div>
                {noCost > 0 ? <span className="chip down">Missing cost prices</span> : <Chip cur={net} prev={prevNet} />}</div>
              {exp && <div className="kpi peach"><Ico d={I.out} /><div className="l">Expenses</div><div className="v">{money(exp.total, cur)}</div><Chip cur={exp.total} prev={exp.prev} /></div>}
              {exp && <div className="kpi"><Ico d={I.trend} /><div className="l">Gross profit</div><div className="v">{money(gross, cur)}</div><span className="chip">{revenue ? `${Math.round((gross / revenue) * 100)}% margin` : 'Sales less cost of goods'}</span></div>}
            </div>

            {noCost > 0 && (
              <div className="alert no-print">
                <Ico d={I.warn} />
                <span><b>Profit is not real yet.</b> {noCost} item{noCost === 1 ? ' has' : 's have'} no cost price, so their full price counts as profit.</span>
                <Link href="/products" className="btn small">Add costs</Link>
              </div>
            )}

            <div className="cols two">
              <div className="card">
                <div className="card-head"><h3>{oneDay ? 'Sales by hour' : 'Sales by day'}</h3>{best && best.v > 0 && <span className="pill">Best: {best.label}</span>}</div>
                <div className="clay-bars" role="img" aria-label={bars.map((b) => `${b.label} ${money(b.v, cur)}`).join(', ')}>
                  {bars.map((b, i) => (
                    <div className="b" key={b.k} title={`${b.label}: ${money(b.v, cur)}`}>
                      {b.v === barMax && b.v > 0 && <em>{num(b.v)}</em>}
                      <i style={{ height: `${Math.max(2.5, (b.v / barMax) * 100)}%`, background: b.v ? `linear-gradient(180deg, ${BAR_COLS[i % 7]}, ${BAR_COLS[i % 7]}CC)` : 'rgba(255,255,255,0.6)', animationDelay: `${i * 30}ms` }} />
                      <span>{b.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="card-head"><h3>How customers paid</h3></div>
                {pays.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No sales in this period.</p> : (
                  <div className="donut">
                    <Donut rows={pays} />
                    <div className="legend">
                      {pays.map((r) => <div key={r.name}><i style={{ background: r.c }} /><span>{r.name}</span><b>{Math.round((r.v / payTotal) * 100)}%</b></div>)}
                      <span className="small muted">{money(payTotal, cur)} in total</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3>Busiest times</h3><span className="pill">{times.length} sale{times.length === 1 ? '' : 's'}</span></div>
              <div className="heat" role="img" aria-label={heat.top ? `Busiest on ${heat.top.day} from ${hourName(heat.top.h)}` : 'No sales yet'}>
                <span />
                {BLOCKS.map((h) => <span key={h} style={{ textAlign: 'center' }}>{hourName(h)}</span>)}
                {DAYS.map((d, i) => (
                  <div key={d} style={{ display: 'contents' }}>
                    <span style={{ alignSelf: 'center' }}>{d}</span>
                    {heat.g[i].map((v, j) => <i key={j} title={`${d} ${hourName(BLOCKS[j])}: ${v} sale${v === 1 ? '' : 's'}`} style={{ background: v ? `rgba(11, 92, 135, ${(0.15 + (v / heat.max) * 0.75).toFixed(2)})` : 'rgba(255,255,255,0.55)' }} />)}
                  </div>
                ))}
              </div>
              <p className="small" style={{ margin: '10px 0 0' }}>
                {heat.top ? <>Busiest: <b>{heat.top.day} {hourName(heat.top.h)} – {hourName(heat.top.h + 2)}</b>. Have enough people and stock ready then.</> : 'The pattern shows once you have a few sales.'}
              </p>
            </div>

            <div className="cols two">
              <Ranked title="Best sellers" rows={data.top_products || []} cur={cur} qty />
              {exp && exp.byCat.length > 0
                ? <Ranked title="Where the money went" rows={exp.byCat} cur={cur} unit="entries" />
                : <Ranked title="By cashier" rows={data.by_cashier || []} cur={cur} />}
              {exp && exp.byCat.length > 0 && <Ranked title="By cashier" rows={data.by_cashier || []} cur={cur} />}
              {branches.length > 1 && <Ranked title="By branch" rows={data.by_branch || []} cur={cur} />}
            </div>

            <Link href="/stock" className="card no-print" style={{ display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none', color: 'inherit' }}>
              <span className="rank" style={{ width: 52, height: 52, borderRadius: 18, fontSize: 18, background: low.length ? 'var(--c-amber)' : 'var(--c-teal)' }}>{low.length}</span>
              <span style={{ flex: 1 }}><b>{low.length ? 'Items need restocking' : 'Stock looks healthy'}</b><br /><span className="small muted">{low.length ? low.slice(0, 3).map((x) => x.name).join(', ') + (low.length > 3 ? '...' : '') : 'Nothing is low or out'}</span></span>
              <span className="go" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg></span>
            </Link>
          </>
        )}
      </div>
    </>
  );
}
