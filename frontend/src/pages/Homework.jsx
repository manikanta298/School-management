import React,{useEffect,useState} from 'react';
import {api} from '../api/client';
import {allPages} from '../api/pagination';
const blank={section_id:'',subject_id:'',title:'',details:'',due_on:''};
export default function Homework({user}){
 const staff=['admin','teacher'].includes(user.role),student=user.role==='student';
 const [items,setItems]=useState([]),[sections,setSections]=useState([]),[classes,setClasses]=useState([]),[subjects,setSubjects]=useState([]),[form,setForm]=useState(blank),[editing,setEditing]=useState(null),[archived,setArchived]=useState(false),[offset,setOffset]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0),[myStudent,setMyStudent]=useState(null);
 useEffect(()=>{if(!staff)return;let active=true;Promise.all([allPages('/academic/sections'),allPages('/academic/classes'),allPages('/academic/subjects')]).then(([s,c,sub])=>{if(active){setSections(s);setClasses(c);setSubjects(sub);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[staff]);
 useEffect(()=>{if(!student)return;let active=true;api('/students?limit=1').then(d=>{if(active)setMyStudent(d.items[0]?.id||null);}).catch(()=>{});return()=>{active=false;};},[student]);
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  api(`/homework?limit=25&offset=${offset}${staff&&archived?'&include_archived=true':''}`).then(d=>{if(active)setItems(d.items);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[offset,archived,revision,staff]);
 const label=s=>`${classes.find(c=>c.id===s.class_id)?.name||'Class'} / ${s.name}`;
 async function run(fn,message){setBusy(true);setError('');setNotice('');try{await fn();setRevision(v=>v+1);setNotice(message);}catch(e){setError(e.message);}finally{setBusy(false);}}
 const change=key=>e=>setForm({...form,[key]:e.target.value});
 async function save(e){e.preventDefault();await run(async()=>{if(editing)await api(`/homework/${editing}`,{method:'PUT',body:{title:form.title,details:form.details,due_on:form.due_on}});else await api('/homework',{method:'POST',body:form});setForm(blank);setEditing(null);},'Homework saved.');}
 return <section><h1>Homework</h1>
 {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
 <div className="grid">{staff&&<form onSubmit={save} className="card"><h2>{editing?'Edit':'Assign'} homework</h2>
 {!editing&&<><label>Class and section<select required value={form.section_id} onChange={change('section_id')}><option value="">Select section</option>{sections.map(s=><option key={s.id} value={s.id}>{label(s)}</option>)}</select></label>
 <label>Subject<select required value={form.subject_id} onChange={change('subject_id')}><option value="">Select subject</option>{subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label></>}
 <label>Title<input required maxLength={150} value={form.title} onChange={change('title')}/></label>
 <label>Details<textarea required maxLength={5000} rows={5} value={form.details} onChange={change('details')}/></label>
 <label>Due date<input type="date" required value={form.due_on} onChange={change('due_on')}/></label>
 <button disabled={busy}>Save homework</button> {editing&&<button type="button" onClick={()=>{setEditing(null);setForm(blank);}}>Cancel edit</button>}
 <p className="muted">Teachers can post only for subjects they teach in that class.</p></form>}
 <div><h2>{staff?'Assigned homework':'Your homework'}</h2>
 {staff&&<label>Show archived<input className="check" type="checkbox" checked={archived} onChange={e=>{setOffset(0);setArchived(e.target.checked);}}/></label>}
 {loading?<p role="status">Loading homework…</p>:!items.length?<p>No homework to show.</p>:items.map(h=>{const done=student&&myStudent&&h.completed_student_ids?.includes(myStudent);return <article className="card" key={h.id}><h3>{h.title}{h.archived_at?' (archived)':''}</h3><p>{h.subject_name} · {h.class_name} / {h.section_name} · due {h.due_on}</p><p style={{whiteSpace:'pre-wrap'}}>{h.details}</p><p className="muted">Posted by {h.posted_by} on {h.assigned_on}{staff?` · ${h.completion_count} completed`:''}{!staff&&!student&&h.completed_student_ids?.length?` · ${h.completed_student_ids.length} child(ren) completed`:''}</p>
 {student&&<button disabled={busy} onClick={()=>run(()=>api(`/homework/${h.id}/complete`,{method:done?'DELETE':'POST'}),done?'Marked as not completed.':'Marked as completed.')}>{done?'Mark as not done':'Mark as done'}</button>}
 {staff&&!h.archived_at&&<><button disabled={busy} onClick={()=>{setEditing(h.id);setForm({section_id:h.section_id,subject_id:h.subject_id,title:h.title,details:h.details,due_on:h.due_on});}}>Edit</button> <button disabled={busy} onClick={()=>run(()=>api(`/homework/${h.id}/archive`,{method:'POST'}),'Homework archived.')}>Archive</button></>}</article>;})}
 <button disabled={loading||offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}>Previous</button> <button disabled={loading||items.length<25} onClick={()=>setOffset(offset+25)}>Next</button></div></div></section>;
}
