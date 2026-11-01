import React,{useEffect,useState} from 'react';
import {api} from '../api/client';
import {allPages} from '../api/pagination';
import TeacherRoster from './TeacherRoster';
export default function TeacherAssignments({teacher,user,options,onClose}){
 const admin=user.role==='admin';
 const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0),[draft,setDraft]=useState({kind:'class_teacher'}),[editing,setEditing]=useState(null),[roster,setRoster]=useState(null),[removing,setRemoving]=useState(null);
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  allPages(`/teachers/${teacher.id}/assignments`).then(data=>{if(active){setItems(data);setRoster(null);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[teacher.id,teacher.employment_status,revision]);
 async function save(e){e.preventDefault();setBusy(true);setError('');setNotice('');try{await api(`/teachers/${teacher.id}/assignments${editing?'/'+editing:''}`,{method:editing?'PUT':'POST',body:{class_id:draft.class_id,kind:draft.kind,subject_id:draft.kind==='subject_teacher'?draft.subject_id:null}});setDraft({kind:'class_teacher'});setEditing(null);setRevision(v=>v+1);setNotice('Assignment saved.');}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function remove(){setBusy(true);setError('');try{await api(`/teachers/${teacher.id}/assignments/${removing.id}`,{method:'DELETE'});setRemoving(null);setRoster(null);setEditing(null);setDraft({kind:'class_teacher'});setRevision(v=>v+1);setNotice('Assignment removed. Roster access for this assignment is revoked.');}catch(e){setError(e.message);}finally{setBusy(false);}}
 function edit(item){setEditing(item.id);setDraft({class_id:item.class_id,kind:item.kind,subject_id:item.subject_id});setRemoving(null);setRoster(null);}
 const yearName=id=>options.years.find(y=>y.id===id)?.name||id;
 return <section className="detail-panel" aria-label="Teacher assignments"><button disabled={busy} onClick={onClose}>Close assignments</button><h2>{teacher.name} · Assignments</h2>
 {teacher.employment_status==='inactive'&&<p className="notice">This profile is inactive. Assignments are retained; teacher roster access is disabled. An administrator must reactivate the profile before adding or editing assignments.</p>}
 {error&&<p className="error" role="alert">{error} <button disabled={busy} onClick={()=>setRevision(v=>v+1)}>Reload</button></p>}{notice&&<p className="notice" role="status">{notice}</p>}
 {loading?<p role="status">Loading assignments…</p>:<div className={admin?'grid':''}>
 {admin&&<div className="card"><h3>{editing?'Edit':'Create'} assignment</h3><p>Each class can have one class teacher and one teacher per subject. Assignments cover every section in that class.</p><form onSubmit={save}>
 <label>Class and academic year<select required value={draft.class_id||''} onChange={e=>setDraft({...draft,class_id:e.target.value})}><option value="">Select class</option>{options.classes.map(c=><option key={c.id} value={c.id}>{c.name} · {yearName(c.academic_year_id)}</option>)}</select></label>
 <label>Assignment type<select value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value,subject_id:null})}><option value="class_teacher">Class teacher</option><option value="subject_teacher">Subject teacher</option></select></label>
 {draft.kind==='subject_teacher'&&<label>Subject<select required value={draft.subject_id||''} onChange={e=>setDraft({...draft,subject_id:e.target.value})}><option value="">Select subject</option>{options.subjects.map(s=><option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}</select></label>}
 <button disabled={busy||teacher.employment_status!=='active'}>Save assignment</button> {editing&&<button type="button" disabled={busy} onClick={()=>{setEditing(null);setDraft({kind:'class_teacher'});}}>Cancel edit</button>}</form></div>}
 <div><h3>Assigned classes and subjects</h3>{!items.length&&<p>No assignments yet. {admin?'Create one using the form.':'Contact the school administrator to request an assignment.'}</p>}
 {items.map(item=><article className="card" key={item.id}><h4>{item.class_name} · {item.academic_year_name}</h4><p>{item.kind==='class_teacher'?'Class teacher':`${item.subject_name} (${item.subject_code})`}</p>
 <button disabled={busy||(!admin&&teacher.employment_status!=='active')} onClick={()=>setRoster(item)}>View roster</button> {admin&&<><button disabled={busy||teacher.employment_status!=='active'} onClick={()=>edit(item)}>Edit assignment</button> <button disabled={busy} onClick={()=>setRemoving(item)}>Remove assignment</button></>}
 </article>)}</div></div>}
 {removing&&<div className="card" role="alert"><p>Remove assignment for {removing.class_name}{removing.subject_name?' / '+removing.subject_name:''}? This removes roster access through this assignment.</p><button disabled={busy} onClick={remove}>Confirm removal</button> <button disabled={busy} onClick={()=>setRemoving(null)}>Cancel</button></div>}
 {roster&&<TeacherRoster key={roster.id} teacherId={teacher.id} assignment={roster} onClose={()=>setRoster(null)}/>}
 </section>;
}
