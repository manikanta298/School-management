import React,{useEffect,useState} from 'react';
import {api} from '../api/client';
import {allPages} from '../api/pagination';
import StudentDetails from './StudentDetails';
const dateOnly=value=>String(value??'').slice(0,10);
const emptyOptions={accounts:[],parents:[],years:[],classes:[],sections:[]};
async function accountOptions(){
 const users=[];for(let offset=0;;offset+=100){const data=await api(`/users?limit=100&offset=${offset}`);users.push(...data.users);if(data.users.length<100)return users;}
}
export default function StudentsParents({user}){
 const admin=user.role==='admin';
 const [kind,setKind]=useState('students'),[items,setItems]=useState([]),[options,setOptions]=useState(emptyOptions),[offset,setOffset]=useState(0),[search,setSearch]=useState(''),[q,setQ]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0),[editing,setEditing]=useState(null),[draft,setDraft]=useState({}),[selected,setSelected]=useState(null),[removing,setRemoving]=useState(null);
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  async function load(){
   const [data,choices]=await Promise.all([api(`/${kind}?limit=25&offset=${offset}&q=${encodeURIComponent(q)}`),admin?Promise.all([accountOptions(),allPages('/parents'),allPages('/academic/academic-years'),allPages('/academic/classes'),allPages('/academic/sections')]):Promise.resolve(null)]);
   if(active){setItems(data.items);if(choices)setOptions({accounts:choices[0],parents:choices[1],years:choices[2],classes:choices[3],sections:choices[4]});}
  }
  load().catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[kind,offset,q,revision,admin]);
 function tab(value){setKind(value);setOffset(0);setSearch('');setQ('');setEditing(null);setDraft({});setSelected(null);setRemoving(null);setNotice('');}
 function edit(item){setEditing(item.id);setSelected(null);setRemoving(null);setDraft(kind==='students'?{admission_number:item.admission_number,admission_date:dateOnly(item.admission_date),date_of_birth:dateOnly(item.date_of_birth),address:item.address||''}:{phone:item.phone||'',address:item.address||''});}
 async function save(e){e.preventDefault();setBusy(true);setError('');setNotice('');
  const body=kind==='students'?{admission_number:draft.admission_number,admission_date:draft.admission_date,date_of_birth:draft.date_of_birth||null,address:draft.address||null}:{phone:draft.phone||null,address:draft.address||null};if(!editing)body.user_id=draft.user_id;
  try{await api(`/${kind}${editing?'/'+editing:''}`,{method:editing?'PUT':'POST',body});setEditing(null);setDraft({});setSelected(null);setOffset(0);setRevision(v=>v+1);setNotice('Profile saved.');}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function remove(){setBusy(true);setError('');try{await api(`/${kind}/${removing.id}`,{method:'DELETE'});setRemoving(null);setSelected(null);setEditing(null);setDraft({});setOffset(0);setRevision(v=>v+1);setNotice('Profile deleted. The login account is retained.');}catch(e){setError(e.message);}finally{setBusy(false);}}
 const input=(key,label,type='text',required=false,maxLength)=><label>{label}<input type={type} required={required} value={draft[key]||''} maxLength={maxLength} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>;
 return <section><p className="eyebrow">STUDENT SERVICES</p><h1>{admin?'Students & Parents':user.role==='parent'?'My family':'My student profile'}</h1><p>{admin?'Create login accounts in Manage users first, then add profiles here. Names and emails come from those accounts.':'You can view your authorized records here. Contact the school administrator to request corrections.'}</p>
 {(admin||user.role==='parent')&&<nav aria-label="Profile type"><button aria-pressed={kind==='students'} disabled={busy} onClick={()=>tab('students')}>{admin?'Students':'My children'}</button><button aria-pressed={kind==='parents'} disabled={busy} onClick={()=>tab('parents')}>{admin?'Parents':'My parent profile'}</button></nav>}
 {error&&<p className="error" role="alert">{error} <button disabled={busy} onClick={()=>setRevision(v=>v+1)}>Reload</button></p>}{notice&&<p className="notice" role="status">{notice}</p>}
 <form className="search-form" onSubmit={e=>{e.preventDefault();setOffset(0);setQ(search);}}><label>Search name, email{kind==='students'?' or admission number':''}<input maxLength={100} value={search} onChange={e=>setSearch(e.target.value)}/></label><button disabled={busy||loading}>Search</button></form>
 {loading?<p role="status">Loading profiles…</p>:<div className={admin?'grid':''}>
 {admin&&<div className="card"><h2>{editing?'Edit':'Create'} {kind==='students'?'student':'parent'} profile</h2><form onSubmit={save}>
 {!editing&&<label>Existing {kind==='students'?'student':'parent'} account<select required value={draft.user_id||''} onChange={e=>setDraft({...draft,user_id:e.target.value})}><option value="">Select account</option>{options.accounts.filter(u=>u.role===(kind==='students'?'student':'parent')).map(u=><option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}</select></label>}
 {kind==='students'?<>{input('admission_number','Admission number','text',true,30)}{input('admission_date','Admission date','date',true)}{input('date_of_birth','Date of birth (optional)','date')}</>:input('phone','Phone (optional)','tel',false,30)}
 <label>Address (optional)<textarea maxLength={500} rows={3} value={draft.address||''} onChange={e=>setDraft({...draft,address:e.target.value})}/></label>
 <button disabled={busy}>Save profile</button> {editing&&<button type="button" disabled={busy} onClick={()=>{setEditing(null);setDraft({});}}>Cancel edit</button>}</form></div>}
 <div><h2>{kind==='students'?'Students':'Parents'}</h2>{!items.length&&<p>No matching profiles. {admin?'Create an account and profile to get started.':'Your school may not have set up your profile or family links yet.'}</p>}{items.map(item=><article className="card" key={item.id}><h3>{item.name}</h3><p>{item.email}</p>{kind==='students'?<><p>Admission: {item.admission_number} · {dateOnly(item.admission_date)}</p>{item.date_of_birth&&<p>Date of birth: {dateOnly(item.date_of_birth)}</p>}</>:item.phone&&<p>Phone: {item.phone}</p>}{item.address&&<p className="address">{item.address}</p>}
 {kind==='students'&&<button disabled={busy} onClick={()=>{setSelected(item);setEditing(null);setDraft({});}}>Family & enrollment</button>} {admin&&<><button disabled={busy} onClick={()=>edit(item)}>Edit profile</button> <button disabled={busy} onClick={()=>setRemoving(item)}>Delete profile</button></>}
 </article>)}<button disabled={busy||offset===0} onClick={()=>{setSelected(null);setOffset(v=>Math.max(0,v-25));}}>Previous</button> <button disabled={busy||items.length<25} onClick={()=>{setSelected(null);setOffset(v=>v+25);}}>Next</button><p>Page {Math.floor(offset/25)+1}</p></div>
 </div>}
 {removing&&<div className="card" role="alert"><p>Delete profile for {removing.name}? Linked parents and enrollment records must be removed first. The login account is retained.</p><button disabled={busy} onClick={remove}>Confirm delete</button> <button disabled={busy} onClick={()=>setRemoving(null)}>Cancel</button></div>}
 {selected&&<StudentDetails key={selected.id} student={selected} user={user} options={options} onClose={()=>setSelected(null)}/>}
 </section>;
}
