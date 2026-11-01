import React,{useEffect,useState} from 'react';
import {api} from '../api/client';
import {allPages} from '../api/pagination';
import AttendanceRegister from './AttendanceRegister';
import AttendanceReport from './AttendanceReport';
const day=value=>String(value).slice(0,10);
function dateFor(section,today){const end=day(section.end_date);return end<today?end:today;}
function rangeFor(section,date){const month=date.slice(0,8)+'01',start=day(section?.start_date||month);return {from:start>month&&start<=date?start:month,to:date};}
export default function Attendance({user}){
 const staff=['admin','teacher'].includes(user.role),personal=user.role!=='teacher';
 const [sections,setSections]=useState([]),[students,setStudents]=useState([]),[sectionId,setSectionId]=useState(''),[studentId,setStudentId]=useState(''),[date,setDate]=useState(''),[today,setToday]=useState(''),[mode,setMode]=useState(staff?'register':'history'),[range,setRange]=useState({from:'',to:''}),[applied,setApplied]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0),[dirty,setDirty]=useState(false);
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  Promise.all([api('/attendance/calendar'),staff?allPages('/attendance/sections'):Promise.resolve([]),personal?allPages('/students'):Promise.resolve([])]).then(([calendar,s,children])=>{if(active){setToday(calendar.today);setSections(s);setStudents(children);const initial=s.find(sec=>day(sec.start_date)<=calendar.today&&day(sec.end_date)>=calendar.today)||s.find(sec=>day(sec.start_date)<=calendar.today)||s[0];setSectionId(initial?.id||'');setStudentId(children[0]?.id||'');const chosen=initial?dateFor(initial,calendar.today):calendar.today;setDate(chosen);const dates=rangeFor(initial,chosen);setRange(dates);setApplied(dates);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[staff,personal,revision]);
 const selected=sections.find(s=>s.id===sectionId);
 function select(value){setSectionId(value);const sec=sections.find(s=>s.id===value),chosen=dateFor(sec,today);setDate(chosen);const dates=rangeFor(sec,chosen);setRange(dates);setApplied(dates);}
 return <section><p className="eyebrow">DAILY ATTENDANCE</p><h1>Attendance</h1><p>School date: {today||'…'}. Unmarked students are never automatically counted absent.</p>
 {error&&<p className="error" role="alert">{error} <button disabled={dirty} onClick={()=>setRevision(v=>v+1)}>Reload</button></p>}
 {loading?<p role="status">Loading attendance options…</p>:<>
 <nav aria-label="Attendance views">{staff&&<><button disabled={dirty} aria-pressed={mode==='register'} onClick={()=>setMode('register')}>Daily register</button><button disabled={dirty} aria-pressed={mode==='summary'} onClick={()=>setMode('summary')}>Section summary</button></>}{personal&&<button disabled={dirty} aria-pressed={mode==='history'} onClick={()=>setMode('history')}>Student history</button>}</nav>
 {mode==='history'?<label>Student<select value={studentId} onChange={e=>setStudentId(e.target.value)}><option value="">Select student</option>{students.map(s=><option key={s.id} value={s.id}>{s.name} · {s.admission_number}</option>)}</select></label>:<label>Class / section and academic year<select disabled={dirty} value={sectionId} onChange={e=>select(e.target.value)}><option value="">Select section</option>{sections.map(s=><option key={s.id} value={s.id}>{s.class_name} / {s.name} · {s.academic_year_name}</option>)}</select></label>}
 {mode!=='history'&&!sections.length&&<p>No authorized sections. Teachers need an active profile and class or subject assignment.</p>}{mode==='history'&&!students.length&&<p>No authorized student profiles. Contact the school administrator to set up your profile or family link.</p>}
 {mode==='register'&&selected&&<><label>Attendance date<input type="date" value={date} min={day(selected.start_date)} max={day(selected.end_date)<today?day(selected.end_date):today} disabled={dirty} onChange={e=>setDate(e.target.value)}/></label>{date>=day(selected.start_date)&&date<=day(selected.end_date)&&date<=today?<AttendanceRegister key={sectionId+date} section={selected} date={date} user={user} onDirty={setDirty}/>:<p>Select a date within this academic year on or before today. Future years are not open for marking.</p>}</>}
 {mode!=='register'&&((mode==='history'&&studentId)||(mode==='summary'&&selected))&&<><form className="range-form" onSubmit={e=>{e.preventDefault();setApplied({...range});}}><label>From<input type="date" required value={range.from} onChange={e=>setRange({...range,from:e.target.value})}/></label><label>To<input type="date" required min={range.from} value={range.to} onChange={e=>setRange({...range,to:e.target.value})}/></label><button>Apply date range</button><p>Choose up to 366 inclusive days.</p></form>{applied&&<AttendanceReport key={mode+sectionId+studentId+applied.from+applied.to} sectionId={mode==='summary'?sectionId:null} studentId={mode==='history'?studentId:null} range={applied}/>}</>}
 </>}
 </section>;
}
