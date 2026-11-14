import React,{useEffect,useState} from 'react';
import {api} from '../api/client';
const TYPES=['accountant','receptionist','administrative','transport','librarian','attender','security'];
const blank={employee_number:'',name:'',staff_type:'administrative',phone:'',email:'',address:'',joining_date:'',employment_status:'active'};
export default function Staff(){
 const [items,setItems]=useState([]),[filters,setFilters]=useState({q:'',staff_type:'',employment_status:''}),[offset,setOffset]=useState(0),[form,setForm]=useState(blank),[editing,setEditing]=useState(null),[removing,setRemoving]=useState(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  const params=new URLSearchParams({limit:'25',offset:String(offset)});for(const [k,v] of Object.entries(filters))if(v)params.set(k,v);
  api(`/staff?${params}`).then(d=>{if(active)setItems(d.items);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[filters,offset,revision]);
 const change=key=>e=>setForm({...form,[key]:e.target.value});
 const filter=key=>e=>{setOffset(0);setFilters({...filters,[key]:e.target.value});};
 async function run(fn,message){setBusy(true);setError('');setNotice('');try{await fn();setRevision(v=>v+1);setNotice(message);}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function save(e){e.preventDefault();const body={...form,phone:form.phone||null,email:form.email||null,address:form.address||null};await run(async()=>{await api(editing?`/staff/${editing}`:'/staff',{method:editing?'PUT':'POST',body});setForm(blank);setEditing(null);},'Staff member saved.');}
 async function remove(){await run(async()=>{await api(`/staff/${removing.id}`,{method:'DELETE'});setRemoving(null);},'Staff record removed.');}
 return <section><h1>Staff</h1><p className="muted">Non-teaching employees. Mark staff inactive when they leave rather than deleting them.</p>
 {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
 <div className="grid"><form onSubmit={save} className="card"><h2>{editing?'Edit':'Add'} staff member</h2>
 <label>Employee number<input required maxLength={30} value={form.employee_number} onChange={change('employee_number')}/></label>
 <label>Full name<input required maxLength={100} value={form.name} onChange={change('name')}/></label>
 <label>Role<select value={form.staff_type} onChange={change('staff_type')}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></label>
 <label>Phone<input value={form.phone} onChange={change('phone')}/></label>
 <label>Email<input type="email" value={form.email} onChange={change('email')}/></label>
 <label>Address<input maxLength={500} value={form.address} onChange={change('address')}/></label>
 <label>Joining date<input type="date" required value={form.joining_date} onChange={change('joining_date')}/></label>
 <label>Employment<select value={form.employment_status} onChange={change('employment_status')}><option>active</option><option>inactive</option></select></label>
 <button disabled={busy}>Save staff member</button> {editing&&<button type="button" disabled={busy} onClick={()=>{setEditing(null);setForm(blank);}}>Cancel edit</button>}</form>
 <div><h2>Staff directory</h2><div className="card"><label>Search<input value={filters.q} onChange={filter('q')} placeholder="Name or employee number"/></label><label>Role<select value={filters.staff_type} onChange={filter('staff_type')}><option value="">All roles</option>{TYPES.map(t=><option key={t}>{t}</option>)}</select></label><label>Employment<select value={filters.employment_status} onChange={filter('employment_status')}><option value="">All</option><option>active</option><option>inactive</option></select></label></div>
 {loading?<p role="status">Loading staff…</p>:!items.length?<p>No staff found.</p>:items.map(s=><article className="card" key={s.id}><h3>{s.name} · {s.employee_number}</h3><p>{s.staff_type} · {s.employment_status} · joined {s.joining_date}</p>{s.phone&&<p>{s.phone}</p>}{s.email&&<p>{s.email}</p>}
 <button disabled={busy} onClick={()=>{setEditing(s.id);setForm({employee_number:s.employee_number,name:s.name,staff_type:s.staff_type,phone:s.phone||'',email:s.email||'',address:s.address||'',joining_date:s.joining_date,employment_status:s.employment_status});}}>Edit</button> <button disabled={busy} onClick={()=>setRemoving(s)}>Delete</button></article>)}
 {removing&&<div className="card" role="alert"><p>Permanently delete {removing.name}? Use inactive status for staff who left.</p><button disabled={busy} onClick={remove}>Confirm delete</button> <button disabled={busy} onClick={()=>setRemoving(null)}>Cancel</button></div>}
 <button disabled={loading||offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}>Previous</button> <button disabled={loading||items.length<25} onClick={()=>setOffset(offset+25)}>Next</button></div></div></section>;
}
