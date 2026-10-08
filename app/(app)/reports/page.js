'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PRESETS, isoDate, money, num, rangeFor } from '@/lib/util';

function delta(cur, prev) {
  if (!prev) return null;
  const p = ((cur - prev) / prev) * 100;
  return `${p >= 0 ? '+' : ''}${p.toFixed(0)}% vs previous`;
}

function List({ title, rows, cur, qty }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="table-wrap">
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                {qty && <td className="num">{num(r.qty)} sold</td>}
                {!qty && <td className="num">{r.count} sales</td>}
                <td className="num"><b>{money(r.revenue, cur)}</b></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="muted">No data</td></tr>}
          </tbody>
        </table>
      </div>
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
  const [err, setErr] = useState('');

  const range = useMemo(() => rangeFor(preset), [preset]);

  useEffect(() => {
    let off = false;
    setData(null);
    const len = range.to - range.from;
    const pf = new Date(range.from - len);
    const args = (f, t) => ({ p_from: f.toISOString(), p_to: t.toISOString(), p_branch: branchId || null });
    Promise.all([
      supabase.rpc('weekly_report', args(range.from, range.to)),
      supabase.rpc('weekly_report', args(pf, range.from)),
    ]).then(([a, b]) => {
      if (off) return;
      if (a.error) return setErr(a.error.message);
      setErr('');
      setData(a.data);
      setPrev(b.data);
    });
    return () => { off = true; };
  }, [range, branchId]);

  useEffect(() => {
    (async () => {
      const [p, s] = await Promise.all([
        supabase.from('products').select('id,name,low_stock_level').eq('active', true).eq('track_stock', true).range(0, 4999),
        branchId
          ? supabase.from('stock').select('product_id,branch_id,qty').eq('branch_id', branchId).range(0, 9999)
          : supabase.from('stock').select('product_id,branch_id,qty').range(0, 9999),
      ]);
      const tot = {};
      (s.data || []).forEach((x) => (tot[x.product_id] = (tot[x.product_id] || 0) + Number(x.qty)));
      setLow((p.data || []).map((x) => ({ ...x, qty: tot[x.id] || 0 })).filter((x) => x.qty <= Number(x.low_stock_level)).sort((a, b) => a.qty - b.qty).slice(0, 15));
    })();
  }, [branchId]);

  const days = useMemo(() => {
    if (!data) return [];
    const map = {};
    (data.by_day || []).forEach((d) => (map[d.day] = Number(d.revenue)));
    const out = [];
    for (let d = new Date(range.from); d < range.to; d.setDate(d.getDate() + 1)) {
      const k = isoDate(d);
      out.push({ k, label: d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric' }), v: map[k] || 0 });
    }
    return out;
  }, [data, range]);

  const max = Math.max(1, ...days.map((d) => d.v));
  const t = data?.totals;
  const pt = prev?.totals;

  return (
    <>
      <div className="row between no-print" style={{ marginBottom: 12 }}>
        <h1>Reports</h1>
        <div className="row">
          <select className="input" style={{ width: 180 }} value={preset} onChange={(e) => setPreset(e.target.value)}>
            {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          {branches.length > 1 && (
            <select className="input" style={{ width: 200 }} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button className="btn" onClick={() => { document.body.classList.add('print-report'); window.print(); setTimeout(() => document.body.classList.remove('print-report'), 500); }}>Print</button>
        </div>
      </div>
      <div className="receipt-print">
        <p className="muted small">{business.name} / {range.from.toLocaleDateString('en-KE', { dateStyle: 'medium' })} to {new Date(range.to - 1).toLocaleDateString('en-KE', { dateStyle: 'medium' })}</p>
        {err && <div className="err">{err}</div>}
        {!data && !err && <div className="muted">Loading...</div>}
        {data && (
          <>
            <div className="kpis">
              <div className="kpi"><div className="v">{money(t.revenue, cur)}</div><div className="l">Revenue</div><div className="small muted">{delta(Number(t.revenue), Number(pt?.revenue))}</div></div>
              <div className="kpi"><div className="v">{t.count}</div><div className="l">Sales</div><div className="small muted">{delta(t.count, pt?.count)}</div></div>
              <div className="kpi"><div className="v">{money(data.profit, cur)}</div><div className="l">Estimated profit</div><div className="small muted">{delta(Number(data.profit), Number(prev?.profit))}</div></div>
              <div className="kpi"><div className="v">{t.count ? money(Number(t.revenue) / t.count, cur) : '-'}</div><div className="l">Average sale</div></div>
            </div>
            <div className="card">
              <h3>Revenue per day</h3>
              <div className="bars">
                {days.map((d) => (
                  <div className="bar" key={d.k}>
                    <div className="val">{d.v ? num(d.v) : ''}</div>
                    <div className="fill" style={{ height: `${(d.v / max) * 100}%` }} />
                    <div className="lab">{d.label}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="cols two">
              <List title="Best sellers" rows={data.top_products} cur={cur} qty />
              <List title="By payment method" rows={data.by_payment} cur={cur} />
              <List title="By branch" rows={data.by_branch} cur={cur} />
              <List title="By cashier" rows={data.by_cashier} cur={cur} />
            </div>
            <div className="card">
              <h3>Running low</h3>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {low.map((x) => <tr key={x.id}><td>{x.name}</td><td className="num"><span className="badge red">{num(x.qty)} left</span></td></tr>)}
                    {low.length === 0 && <tr><td className="muted">Nothing is running low.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
