import React,{useEffect,useState} from 'react';
import {api} from '../api/client';
import {allPages} from '../api/pagination';
import TeacherAssignments from './TeacherAssignments';
const dateOnly=value=>String(value??'').slice(0,10);
const emptyOptions={accounts:[],classes:[],years:[],subjects:[]};
async function accountOptions(){const users=[];for(let offset=0;;offset+=100){const data=await api(`/users?limit=100&offset=${offset}`);users.push(...data.users);if(data.users.length<100)return users;}}
export default function Teachers({user}){
 const admin=user.role==='admin';
 const [items,setItems]=useState([]),[options,setOptions]=useState(emptyOptions),[offset,setOffset]=useState(0),[search,setSearch]=useState(''),[q,setQ]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0),[editing,setEditing]=useState(null),[draft,setDraft]=useState({employment_status:'active'}),[selected,setSelected]=useState(null),[removing,setRemoving]=useState(null);
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  Promise.all([api(`/teachers?limit=25&offset=${offset}&q=${encodeURIComponent(q)}`),admin?Promise.all([accountOptions(),allPages('/academic/classes'),allPages('/academic/academic-years'),allPages('/academic/subjects')]):Promise.resolve(null)]).then(([data,choices])=>{if(active){setItems(data.items);setSelected(current=>current?data.items.find(item=>item.id===current.id)||null:null);if(choices)setOptions({accounts:choices[0],classes:choices[1],years:choices[2],subjects:choices[3]});}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[offset,q,revision,admin]);
 function edit(item){setEditing(item.id);setSelected(null);setRemoving(null);setDraft({employee_number:item.employee_number,joining_date:dateOnly(item.joining_date),phone:item.phone||'',qualification:item.qualification||'',employment_status:item.employment_status});}
 async function save(e){e.preventDefault();setBusy(true);setError('');setNotice('');const body={employee_number:draft.employee_number,joining_date:draft.joining_date,phone:draft.phone||null,qualification:draft.qualification||null,employment_status:draft.employment_status};if(!editing)body.user_id=draft.user_id;
  try{await api(`/teachers${editing?'/'+editing:''}`,{method:editing?'PUT':'POST',body});setDraft({employment_status:'active'});setEditing(null);setSelected(null);setOffset(0);setRevision(v=>v+1);setNotice('Teacher profile saved.');}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function remove(){setBusy(true);setError('');try{await api(`/teachers/${removing.id}`,{method:'DELETE'});setRemoving(null);setSelected(null);setEditing(null);setDraft({employment_status:'active'});setOffset(0);setRevision(v=>v+1);setNotice('Profile deleted; the login account is retained.');}catch(e){setError(e.message);}finally{setBusy(false);}}
 const input=(key,label,type='text',required=false,maxLength)=><label>{label}<input type={type} required={required} value={draft[key]||''} maxLength={maxLength} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>;
 return <section><p className="eyebrow">TEACHING STAFF</p><h1>{admin?'Teachers':'My teaching'}</h1><p>{admin?'Create teacher-role accounts in Manage users first, then create profiles and assign classes or subjects here.':'Your profile, assignments, and active student rosters appear here. Contact the school administrator for corrections.'}</p>
 {error&&<p className="error" role="alert">{error} <button disabled={busy} onClick={()=>setRevision(v=>v+1)}>Reload</button></p>}{notice&&<p className="notice" role="status">{notice}</p>}
 {admin&&<form className="search-form" onSubmit={e=>{e.preventDefault();setOffset(0);setSelected(null);setQ(search);}}><label>Search name, email or employee number<input value={search} maxLength={100} onChange={e=>setSearch(e.target.value)}/></label><button disabled={busy||loading}>Search</button></form>}
 {loading?<p role="status">Loading teacher profiles…</p>:<div className={admin?'grid':''}>
 {admin&&<div className="card"><h2>{editing?'Edit':'Create'} teacher profile</h2><form onSubmit={save}>
 {!editing&&<label>Existing teacher account<select required value={draft.user_id||''} onChange={e=>setDraft({...draft,user_id:e.target.value})}><option value="">Select account</option>{options.accounts.filter(u=>u.role==='teacher').map(u=><option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}</select></label>}
 {input('employee_number','Employee number','text',true,30)}{input('joining_date','Joining date','date',true)}{input('phone','Phone (optional)','tel',false,30)}{input('qualification','Qualification (optional)','text',false,200)}
 <label>Employment status<select value={draft.employment_status} onChange={e=>setDraft({...draft,employment_status:e.target.value})}><option value="active">Active</option><option value="inactive">Inactive</option></select></label><p>Inactive profiles keep their assignments, but teacher roster access is disabled immediately. Their Auth account remains separate.</p>
 <button disabled={busy}>Save profile</button> {editing&&<button type="button" disabled={busy} onClick={()=>{setEditing(null);setDraft({employment_status:'active'});}}>Cancel edit</button>}</form></div>}
 <div><h2>{admin?'Staff profiles':'My profile'}</h2>{!items.length&&<p>No matching teacher profile. {admin?'Select an existing teacher account to create one.':'Your administrator may not have created your profile yet.'}</p>}
 {items.map(item=><article className="card" key={item.id}><h3>{item.name}</h3><p>{item.email} · {item.employee_number}</p><p>Joined: {dateOnly(item.joining_date)} · {item.employment_status}</p>{item.phone&&<p>Phone: {item.phone}</p>}{item.qualification&&<p>Qualification: {item.qualification}</p>}
 <button disabled={busy} onClick={()=>{setSelected(item);setEditing(null);setDraft({employment_status:'active'});}}>Assignments & rosters</button> {admin&&<><button disabled={busy} onClick={()=>edit(item)}>Edit profile</button> <button disabled={busy} onClick={()=>setRemoving(item)}>Delete profile</button></>}
 </article>)}{admin&&<><button disabled={busy||offset===0} onClick={()=>{setSelected(null);setOffset(v=>Math.max(0,v-25));}}>Previous</button> <button disabled={busy||items.length<25} onClick={()=>{setSelected(null);setOffset(v=>v+25);}}>Next</button><p>Page {Math.floor(offset/25)+1}</p></>}
 </div></div>}
 {removing&&<div className="card" role="alert"><p>Delete the profile for {removing.name}? Remove its assignments first. The login account will be retained.</p><button disabled={busy} onClick={remove}>Confirm delete</button> <button disabled={busy} onClick={()=>setRemoving(null)}>Cancel</button></div>}
 {selected&&<TeacherAssignments key={selected.id} teacher={selected} user={user} options={options} onClose={()=>setSelected(null)}/>}
 </section>;
}
