'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fmtDate, money, num } from '@/lib/util';

export default function Admin() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_overview');
    if (error) return setErr(error.message);
    setRows(data);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(b) {
    const next = b.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended' && !window.confirm(`Suspend ${b.name}? Their users will be locked out.`)) return;
    const { error } = await supabase.from('businesses').update({ status: next }).eq('id', b.id);
    if (error) return alert(error.message);
    load();
  }

  if (err) return <div className="err">{err}</div>;
  if (!rows) return <div className="muted">Loading...</div>;

  const week = rows.reduce((s, r) => s + Number(r.revenue_7d), 0);
  const active = rows.filter((r) => r.last_sale && Date.now() - new Date(r.last_sale) < 7 * 864e5).length;

  return (
    <>
      <h1>All businesses</h1>
      <div className="kpis">
        <div className="kpi"><div className="v">{rows.length}</div><div className="l">Businesses</div></div>
        <div className="kpi"><div className="v">{active}</div><div className="l">Sold something in the last 7 days</div></div>
        <div className="kpi"><div className="v">{money(week)}</div><div className="l">Revenue across all, last 7 days</div></div>
        <div className="kpi"><div className="v">{num(rows.reduce((s, r) => s + Number(r.sales_count), 0))}</div><div className="l">Total sales recorded</div></div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Business</th><th>Owner</th><th>Type</th><th className="num">Branches</th><th className="num">Staff</th><th className="num">Sales</th><th className="num">7-day revenue</th><th>Last sale</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td><b>{b.name}</b><div className="small muted">Joined {fmtDate(b.created_at)}</div></td>
                <td>{b.owner_email}</td>
                <td>{b.business_type}</td>
                <td className="num">{b.branches}</td>
                <td className="num">{b.staff}</td>
                <td className="num">{num(b.sales_count)}</td>
                <td className="num">{money(b.revenue_7d)}</td>
                <td>{b.last_sale ? fmtDate(b.last_sale) : 'Never'}</td>
                <td>{b.status === 'active' ? <span className="badge">Active</span> : <span className="badge red">Suspended</span>}</td>
                <td className="right"><button className={`btn small ${b.status === 'active' ? 'danger' : ''}`} onClick={() => toggle(b)}>{b.status === 'active' ? 'Suspend' : 'Reactivate'}</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="10" className="muted">No businesses yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
