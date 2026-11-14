import React,{useEffect,useState} from 'react';
import {api} from '../api/client';
const TYPES=['holiday','event','exam','meeting'];
const blank={title:'',description:'',event_type:'event',starts_on:'',ends_on:''};
const range=e=>e.ends_on===e.starts_on?e.starts_on:`${e.starts_on} to ${e.ends_on}`;
export default function Calendar({user}){
 const admin=user.role==='admin';
 const [items,setItems]=useState([]),[type,setType]=useState(''),[form,setForm]=useState(blank),[editing,setEditing]=useState(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  api(`/calendar?limit=200${type?`&event_type=${type}`:''}`).then(d=>{if(active)setItems(d.items);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[type,revision]);
 const change=key=>e=>setForm({...form,[key]:e.target.value});
 async function run(fn,message){setBusy(true);setError('');setNotice('');try{await fn();setRevision(v=>v+1);setNotice(message);}catch(e){setError(e.message);}finally{setBusy(false);}}
 const save=e=>{e.preventDefault();run(async()=>{await api(editing?`/calendar/${editing}`:'/calendar',{method:editing?'PUT':'POST',body:{title:form.title,description:form.description||null,event_type:form.event_type,starts_on:form.starts_on,ends_on:form.ends_on||form.starts_on}});setForm(blank);setEditing(null);},'Event saved.');};
 return <section><h1>School calendar</h1><p className="muted">Upcoming and ongoing holidays, events, exams and meetings.</p>
 {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
 <div className="grid">{admin&&<form className="card" onSubmit={save}><h2>{editing?'Edit':'Add'} calendar entry</h2>
 <label>Title<input required maxLength={150} value={form.title} onChange={change('title')}/></label>
 <label>Type<select value={form.event_type} onChange={change('event_type')}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></label>
 <label>Starts on<input type="date" required value={form.starts_on} onChange={change('starts_on')}/></label>
 <label>Ends on (optional)<input type="date" min={form.starts_on} value={form.ends_on} onChange={change('ends_on')}/></label>
 <label>Description<textarea maxLength={1000} value={form.description} onChange={change('description')}/></label>
 <button disabled={busy}>Save entry</button> {editing&&<button type="button" onClick={()=>{setEditing(null);setForm(blank);}}>Cancel edit</button>}</form>}
 <div><label>Show<select value={type} onChange={e=>setType(e.target.value)}><option value="">All types</option>{TYPES.map(t=><option key={t}>{t}</option>)}</select></label>
 {loading?<p role="status">Loading calendar…</p>:!items.length?<p>No upcoming entries.</p>:items.map(e=><article className="card" key={e.id}><h3>{e.title} <small>({e.event_type})</small></h3><p>{range(e)}</p>{e.description&&<p>{e.description}</p>}
 {admin&&<><button disabled={busy} onClick={()=>{setEditing(e.id);setForm({title:e.title,description:e.description||'',event_type:e.event_type,starts_on:e.starts_on,ends_on:e.ends_on});}}>Edit</button> <button disabled={busy} onClick={()=>run(()=>api(`/calendar/${e.id}`,{method:'DELETE'}),'Entry deleted.')}>Delete</button></>}</article>)}</div></div></section>;
}
