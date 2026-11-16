import React,{useEffect,useState} from 'react';
import {api} from '../api/client';
const when=v=>new Date(v).toLocaleString();
const device=ua=>ua?ua.slice(0,60):'Unknown device';
export default function SecurityActivity({onSignedOut}){
 const [sessions,setSessions]=useState([]),[history,setHistory]=useState([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=async()=>{const [s,h]=await Promise.all([api('/auth/sessions'),api('/auth/login-history')]);setSessions(s.items);setHistory(h.items);};
 useEffect(()=>{let active=true;setError('');load().catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 const run=async fn=>{setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
 const revoke=s=>run(async()=>{await api(`/auth/sessions/${s.id}`,{method:'DELETE'});if(s.current)onSignedOut();else await load();});
 const all=()=>{if(window.confirm('Sign out of every device, including this one?'))run(async()=>{await api('/auth/logout-all',{method:'POST'});onSignedOut();});};
 return <>
  <h2>Active sessions</h2>
  {error&&<p role="alert" className="error">{error}</p>}
  {loading?<p>Loading…</p>:<div className="table-wrap"><table><thead><tr><th>Device</th><th>IP</th><th>School</th><th>Signed in</th><th></th></tr></thead><tbody>{sessions.map(s=><tr key={s.id}><td>{device(s.user_agent)}{s.current&&' (this device)'}</td><td>{s.ip||'—'}</td><td>{s.school_name||'—'}</td><td>{when(s.created_at)}</td><td><button type="button" disabled={busy} onClick={()=>revoke(s)}>{s.current?'Sign out':'Revoke'}</button></td></tr>)}</tbody></table></div>}
  <p><button type="button" disabled={busy||loading} onClick={all}>Sign out of all devices</button></p>
  <h2>Recent sign-in activity</h2>
  {!loading&&(history.length?<div className="table-wrap"><table><thead><tr><th>When</th><th>Result</th><th>Device</th><th>IP</th></tr></thead><tbody>{history.map(e=><tr key={e.id}><td>{when(e.created_at)}</td><td>{e.success?'Signed in':'Failed'}</td><td>{device(e.user_agent)}</td><td>{e.ip||'—'}</td></tr>)}</tbody></table></div>:<p>No activity recorded yet.</p>)}
 </>;
}
