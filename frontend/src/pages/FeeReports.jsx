import React,{useEffect,useState} from 'react';
import {api} from '../api/client';
import {formatMoney} from '../api/money';
const GROUPS=['month','day','method','class','category'];
export default function FeeReports(){
 const [filter,setFilter]=useState({group_by:'month',from:'',to:''}),[rows,setRows]=useState([]),[defaulters,setDefaulters]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  const params=new URLSearchParams({group_by:filter.group_by});for(const k of ['from','to'])if(filter[k])params.set(k,filter[k]);
  Promise.all([api(`/fees/reports/collection?${params}`),api('/fees/reports/defaulters?limit=100')]).then(([c,d])=>{if(active){setRows(c.items);setDefaulters(d.items);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[filter]);
 const set=key=>e=>setFilter({...filter,[key]:e.target.value});
 return <section aria-label="Fee reports"><h2>Collection report</h2><p className="muted">Reversed payments are excluded. The default range is the current month.</p>
 <div className="grid"><label>Group by<select value={filter.group_by} onChange={set('group_by')}>{GROUPS.map(g=><option key={g}>{g}</option>)}</select></label><label>From<input type="date" value={filter.from} onChange={set('from')}/></label><label>To<input type="date" value={filter.to} onChange={set('to')}/></label></div>
 {error&&<p className="error" role="alert">{error}</p>}
 {loading?<p role="status">Loading reports…</p>:<>
 {!rows.length?<p>No payments in this range.</p>:rows.map(r=><div className="balance-row" key={r.key+r.currency}><strong>{r.key}</strong><span>{formatMoney(r.collected_minor,r.currency)}</span><span>{r.payments} payment(s)</span></div>)}
 <h2>Defaulters</h2><p className="muted">Students with unpaid balances on invoices past their due date.</p>
 {!defaulters.length?<p>No overdue balances.</p>:defaulters.map(d=><div className="balance-row" key={d.student_id+d.currency}><strong>{d.name} · {d.admission_number}</strong><span>{formatMoney(d.outstanding_minor,d.currency)}</span><span>since {d.oldest_due_on}</span></div>)}</>}
 </section>;
}
