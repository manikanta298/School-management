import React,{useEffect,useState} from 'react';
import {api} from '../api/client';
import AttendanceAudit from './AttendanceAudit';
export default function AttendanceRegister({section,date,user,onDirty}){
 const [items,setItems]=useState([]),[version,setVersion]=useState(0),[offset,setOffset]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[draft,setDraft]=useState({}),[reason,setReason]=useState(''),[revision,setRevision]=useState(0),[audit,setAudit]=useState(false);
 const dirty=Object.keys(draft).length>0;
 useEffect(()=>{onDirty(dirty||busy);return()=>onDirty(false);},[dirty,busy,onDirty]);
 useEffect(()=>{let active=true;setLoading(true);setError('');api(`/attendance/register?section_id=${section.id}&date=${date}&limit=25&offset=${offset}`).then(data=>{if(active){setItems(data.items);setVersion(data.register?.version||0);setDraft({});setReason('');}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[section.id,date,offset,revision]);
 function field(row,key,value){setDraft(current=>{const baseline={status:row.status||'',note:row.note||''},next={...baseline,...current[row.student_id],[key]:value},result={...current};if(next.status===baseline.status&&next.note===baseline.note)delete result[row.student_id];else result[row.student_id]=next;return result;});}
 async function save(e){e.preventDefault();setError('');setNotice('');const entries=Object.entries(draft).map(([student_id,value])=>({student_id,status:value.status,note:value.note||null}));if(entries.some(e=>!e.status)){setError('Choose a status for each edited row, or discard the edits.');return;}setBusy(true);try{const data=await api('/attendance/register',{method:'PUT',body:{section_id:section.id,date,expected_version:version,entries,correction_reason:reason||null}});setNotice(`${data.changed} attendance record(s) saved.`);setDraft({});setReason('');setRevision(v=>v+1);setAudit(false);}catch(e){setError(e.message);}finally{setBusy(false);}}
 const canMark=section.can_mark;
 const correcting=items.some(row=>row.status&&draft[row.student_id]);
 return <section><h2>Daily register · {date}</h2><p>New marks use current active enrollments on or before this date. Saved marks stay with their original section after transfers. Students already marked elsewhere that day are excluded.</p>{!canMark&&<p className="notice">You can read this register. Only its class teacher or an administrator can mark it.</p>}
 {error&&<p className="error" role="alert">{error} <button disabled={busy} onClick={()=>{setDraft({});setReason('');setRevision(v=>v+1);}}>Reload and discard edits</button></p>}{notice&&<p className="notice" role="status">{notice}</p>}
 {loading?<p role="status">Loading register…</p>:<form onSubmit={save}>
 {!items.length?<p>No eligible students or saved records for this date.</p>:<>
 {canMark&&<button type="button" disabled={busy} onClick={()=>items.filter(r=>!r.status&&!draft[r.student_id]?.status).forEach(row=>field(row,'status','present'))}>Set unmarked rows present on this page</button>}
 <div className="table-wrap"><table><caption>{section.class_name} / {section.name} · {section.academic_year_name}</caption><thead><tr><th scope="col">Student</th><th scope="col">Status</th><th scope="col">Note</th></tr></thead><tbody>{items.map(row=><tr key={row.student_id}><td>{row.name}<br/>{row.admission_number}</td><td>{canMark?<select disabled={busy} aria-label={`Status for ${row.name}`} value={draft[row.student_id]?.status??row.status??''} onChange={e=>field(row,'status',e.target.value)}><option value="" disabled={!!row.status}>Not marked</option>{['present','absent','late','excused',...(row.status?['void']:[])].map(s=><option key={s} value={s}>{s==='void'?'Void (error)':s}</option>)}</select>:row.status||'Not marked'}</td><td>{canMark?<input disabled={busy} aria-label={`Note for ${row.name}`} maxLength={200} value={draft[row.student_id]?.note??row.note??''} onChange={e=>field(row,'note',e.target.value)}/>:row.note||'—'}</td></tr>)}</tbody></table></div>
 {canMark&&<><label>Correction reason {correcting?'(required for saved marks)':'(optional for new marks)'}<input value={reason} maxLength={200} minLength={correcting?3:undefined} required={correcting} disabled={busy} onChange={e=>setReason(e.target.value)}/></label><button disabled={busy||!dirty}>Save edited rows</button> <button type="button" disabled={busy||!dirty} onClick={()=>{setDraft({});setReason('');}}>Discard edits</button></>}
 </>}
 </form>}
 {dirty&&<p role="status">Save or discard edits before changing the date, section, tab or page.</p>}
 <button disabled={busy||loading||dirty||offset===0} onClick={()=>setOffset(v=>Math.max(0,v-25))}>Previous</button> <button disabled={busy||loading||dirty||items.length<25} onClick={()=>setOffset(v=>v+25)}>Next</button><p>Page {Math.floor(offset/25)+1}</p>
 {user.role==='admin'&&<><button disabled={busy||dirty} onClick={()=>setAudit(v=>!v)}>{audit?'Hide':'View'} audit history</button>{audit&&<AttendanceAudit key={revision} sectionId={section.id} date={date}/>}</>}
 </section>;
}
