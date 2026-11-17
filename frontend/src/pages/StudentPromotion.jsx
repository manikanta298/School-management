import React,{useEffect,useMemo,useState} from 'react';
import {api} from '../api/client';
import {allPages} from '../api/pagination';
export default function StudentPromotion(){
 const [years,setYears]=useState([]),[classes,setClasses]=useState([]),[sections,setSections]=useState([]),[loading,setLoading]=useState(true);
 const [fromYear,setFromYear]=useState(''),[fromSection,setFromSection]=useState(''),[toYear,setToYear]=useState(''),[toSection,setToSection]=useState('');
 const [students,setStudents]=useState([]),[picked,setPicked]=useState(new Set()),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{let active=true;Promise.all([allPages('/academic/academic-years'),allPages('/academic/classes'),allPages('/academic/sections')]).then(([y,c,s])=>{if(active){setYears(y);setClasses(c);setSections(s);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 const classYear=useMemo(()=>new Map(classes.map(c=>[c.id,c])),[classes]);
 const label=s=>`${classYear.get(s.class_id)?.name||'Class'} – ${s.name}`;
 const options=year=>sections.filter(s=>classYear.get(s.class_id)?.academic_year_id===year);
 const reset=()=>{setPreview(null);setNotice('');setError('');};
 useEffect(()=>{setPreview(null);setError('');setStudents([]);setPicked(new Set());if(!fromYear||!fromSection)return;let active=true;
  allPages(`/students?academic_year_id=${fromYear}&section_id=${fromSection}&status=active`).then(items=>{if(active){setStudents(items);setPicked(new Set(items.map(s=>s.id)));}}).catch(e=>{if(active)setError(e.message);});
  return()=>{active=false;};},[fromYear,fromSection]);
 const moves=students.filter(s=>picked.has(s.id)).map(s=>({student_id:s.id,section_id:toSection}));
 const ready=toYear&&toSection&&moves.length>0&&fromYear!==toYear;
 const toggle=id=>{reset();setPicked(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});};
 const run=async dry=>{setBusy(true);setError('');setNotice('');try{const r=await api('/students/promote',{method:'POST',body:{dry_run:dry,to_academic_year_id:toYear,moves}});if(dry)setPreview(r);else{setNotice(`${moves.length} student(s) promoted.`);setPreview(null);setStudents([]);setPicked(new Set());setFromSection('');}}catch(e){setError(e.message);}finally{setBusy(false);}};
 const apply=()=>{if(window.confirm(`Promote ${moves.length} student(s)? Their current enrollments will be marked completed.`))run(false);};
 const name=id=>students.find(s=>s.id===id)?.name||id;
 return <section className="card" aria-labelledby="promotion-heading">
  <h2 id="promotion-heading">Promote students</h2>
  <p>Move active students from one academic year to a section in the next. Preview first; nothing changes until you confirm.</p>
  {loading?<p>Loading…</p>:<>
   <div className="grid">
    <label>From year<select value={fromYear} onChange={e=>{setFromYear(e.target.value);setFromSection('');}}><option value="">Choose…</option>{years.map(y=><option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
    <label>From section<select value={fromSection} disabled={!fromYear} onChange={e=>setFromSection(e.target.value)}><option value="">Choose…</option>{options(fromYear).map(s=><option key={s.id} value={s.id}>{label(s)}</option>)}</select></label>
    <label>To year<select value={toYear} onChange={e=>{reset();setToYear(e.target.value);setToSection('');}}><option value="">Choose…</option>{years.filter(y=>y.id!==fromYear).map(y=><option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
    <label>To section<select value={toSection} disabled={!toYear} onChange={e=>{reset();setToSection(e.target.value);}}><option value="">Choose…</option>{options(toYear).map(s=><option key={s.id} value={s.id}>{label(s)}</option>)}</select></label>
   </div>
   {students.length>0&&<fieldset><legend>Students ({picked.size} of {students.length} selected)</legend>{students.map(s=><label key={s.id} className="check"><input type="checkbox" checked={picked.has(s.id)} onChange={()=>toggle(s.id)}/> {s.name} ({s.admission_number})</label>)}</fieldset>}
   {fromYear&&fromSection&&students.length===0&&!error&&<p>No active students in that section.</p>}
   <p><button type="button" disabled={busy||!ready} onClick={()=>run(true)}>Preview</button> <button type="button" disabled={busy||!preview?.valid} onClick={apply}>Promote {preview?.valid?moves.length:''} student(s)</button></p>
   {preview&&(preview.valid?<p role="status">All {preview.results.length} student(s) can be promoted.</p>:<div role="alert" className="error"><p>Fix these before promoting:</p><ul>{preview.results.filter(r=>r.errors.length).map(r=><li key={r.row}>{name(r.student_id)}: {r.errors.join('; ')}</li>)}</ul></div>)}
  </>}
  {error&&<p role="alert" className="error">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
