import React,{useEffect,useState} from 'react';
import {api} from '../api/client';
import {allPages} from '../api/pagination';
export default function TeacherRoster({teacherId,assignment,onClose}){
 const [items,setItems]=useState([]),[sections,setSections]=useState([]),[section,setSection]=useState(''),[search,setSearch]=useState(''),[q,setQ]=useState(''),[offset,setOffset]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;allPages(`/academic/sections?class_id=${assignment.class_id}`).then(data=>{if(active)setSections(data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[assignment.class_id]);
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  api(`/teachers/${teacherId}/assignments/${assignment.id}/roster?limit=25&offset=${offset}&q=${encodeURIComponent(q)}${section?'&section_id='+section:''}`).then(data=>{if(active)setItems(data.items);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[teacherId,assignment.id,offset,q,section,revision]);
 return <section className="detail-panel" aria-label="Assigned class roster"><button onClick={onClose}>Close roster</button><h3>{assignment.class_name} · {assignment.academic_year_name}</h3><p>{assignment.kind==='class_teacher'?'Class teacher':assignment.subject_name} · Active enrollments only</p>
 <form onSubmit={e=>{e.preventDefault();setOffset(0);setQ(search);}}><label>Search student name or admission number<input value={search} maxLength={100} onChange={e=>setSearch(e.target.value)}/></label><button disabled={loading}>Search</button></form>
 <label>Section<select value={section} onChange={e=>{setSection(e.target.value);setOffset(0);}}><option value="">All sections</option>{sections.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
 {error&&<p className="error" role="alert">{error} <button onClick={()=>setRevision(v=>v+1)}>Retry</button></p>}
 {loading?<p role="status">Loading roster…</p>:error?null:items.length?<div className="table-wrap"><table><caption>Students assigned to this class</caption><thead><tr><th scope="col">Name</th><th scope="col">Admission number</th><th scope="col">Section</th></tr></thead><tbody>{items.map(s=><tr key={s.student_id}><td>{s.name}</td><td>{s.admission_number}</td><td>{s.section_name}</td></tr>)}</tbody></table></div>:<p>No matching active enrollments.</p>}
 <button disabled={loading||offset===0} onClick={()=>setOffset(v=>Math.max(0,v-25))}>Previous</button> <button disabled={loading||!!error||items.length<25} onClick={()=>setOffset(v=>v+25)}>Next</button><p>Page {Math.floor(offset/25)+1}</p>
 </section>;
}
