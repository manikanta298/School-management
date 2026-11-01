import React,{useEffect,useState} from 'react';
import {api} from '../api/client';
const types={
 'academic-years':{label:'Academic years',fields:[['name','Name'],['start_date','Start date','date'],['end_date','End date','date'],['is_current','Current year','checkbox']]},
 terms:{label:'Terms',fields:[['name','Name'],['academic_year_id','Academic year','year'],['start_date','Start date','date'],['end_date','End date','date']]},
 classes:{label:'Classes',fields:[['name','Name'],['academic_year_id','Academic year','year']]},
 sections:{label:'Sections',fields:[['name','Name'],['class_id','Class','class'],['capacity','Capacity','number']]},
 subjects:{label:'Subjects',fields:[['name','Name'],['code','Code']]}
};
const dateOnly=value=>String(value??'').slice(0,10);
async function optionsFor(resource){
 const result=[];
 for(let offset=0;;offset+=100){const {items}=await api(`/academic/${resource}?limit=100&offset=${offset}`);result.push(...items);if(items.length<100)return result;}
}
export default function AcademicSetup({user}){
 const [resource,setResource]=useState('academic-years'),[offset,setOffset]=useState(0),[items,setItems]=useState([]),[years,setYears]=useState([]),[classes,setClasses]=useState([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[editing,setEditing]=useState(null),[draft,setDraft]=useState({}),[reload,setReload]=useState(0),[removing,setRemoving]=useState(null);
 const admin=user.role==='admin';
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  Promise.all([api(`/academic/${resource}?limit=25&offset=${offset}`),optionsFor('academic-years'),optionsFor('classes')]).then(([data,y,c])=>{if(active){setItems(data.items);setYears(y);setClasses(c);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[resource,offset,reload]);
 function select(key){setResource(key);setOffset(0);setDraft({});setEditing(null);setRemoving(null);setNotice('');}
 function edit(item){setEditing(item.id);setRemoving(null);setNotice('');setDraft(Object.fromEntries(types[resource].fields.map(([key,,type])=>[key,type==='date'?dateOnly(item[key]):item[key]])));}
 async function save(e){e.preventDefault();setBusy(true);setError('');setNotice('');
  const body=Object.fromEntries(types[resource].fields.map(([key,,type])=>[key,type==='checkbox'?!!draft[key]:type==='number'?Number(draft[key]):draft[key]??'']));
  try{await api(`/academic/${resource}${editing?'/'+editing:''}`,{method:editing?'PUT':'POST',body});setDraft({});setEditing(null);setOffset(0);setReload(v=>v+1);setNotice('Saved successfully.');}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function remove(){setBusy(true);setError('');setNotice('');try{await api(`/academic/${resource}/${removing.id}`,{method:'DELETE'});setRemoving(null);setEditing(null);setDraft({});setOffset(0);setReload(v=>v+1);setNotice('Record deleted.');}catch(e){setError(e.message);}finally{setBusy(false);}}
 const yearName=id=>years.find(y=>y.id===id)?.name??id;
 const className=id=>{const c=classes.find(c=>c.id===id);return c?`${c.name} · ${yearName(c.academic_year_id)}`:id;};
 return <section><p className="eyebrow">ACADEMICS</p><h1>Academic setup</h1><p>Set up years first, then terms and classes, followed by sections. Subjects form the school-wide catalog.</p>
 <nav aria-label="Academic resources">{Object.entries(types).map(([key,value])=><button key={key} aria-pressed={resource===key} disabled={busy} onClick={()=>select(key)}>{value.label}</button>)}</nav>
 {error&&<p role="alert" className="error">{error} <button disabled={busy} onClick={()=>setReload(v=>v+1)}>Reload</button></p>}{notice&&<p role="status" className="notice">{notice}</p>}
 {loading?<p role="status">Loading academic records…</p>:<div className={admin?'grid':''}>
 {admin&&<div className="card"><h2>{editing?'Edit':'Create'} {types[resource].label.toLowerCase()}</h2>
 {resource==='academic-years'&&<p>Only one year can be current. To switch, edit the previous current year and clear its checkbox, then mark the new year current.</p>}
 <form onSubmit={save}>{types[resource].fields.map(([key,label,type='text'])=><label key={key}>{label}
 {type==='year'||type==='class'?<select value={draft[key]??''} required onChange={e=>setDraft({...draft,[key]:e.target.value})}><option value="">Select {label.toLowerCase()}</option>{(type==='year'?years:classes).map(item=><option key={item.id} value={item.id}>{type==='year'?item.name:className(item.id)}</option>)}</select>:type==='checkbox'?<input className="check" type="checkbox" checked={!!draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.checked})}/>:<input type={type} required value={draft[key]??''} maxLength={type==='text'?(key==='code'?20:100):undefined} min={type==='number'?1:undefined} max={type==='number'?500:undefined} onChange={e=>setDraft({...draft,[key]:e.target.value})}/>}
 </label>)}<button disabled={busy}>{busy?'Saving…':'Save'}</button> {editing&&<button type="button" disabled={busy} onClick={()=>{setEditing(null);setDraft({});}}>Cancel edit</button>}</form></div>}
 <div><h2>{types[resource].label}</h2>{!items.length&&<p>No records yet.</p>}
 {items.map(item=><article key={item.id} className="card"><h3>{item.name}</h3>{item.is_current&&<p>Current academic year</p>}{item.start_date&&<p>{dateOnly(item.start_date)} — {dateOnly(item.end_date)}</p>}{item.academic_year_id&&<p>Year: {yearName(item.academic_year_id)}</p>}{item.class_id&&<p>Class: {className(item.class_id)}</p>}{item.capacity&&<p>Capacity: {item.capacity}</p>}{item.code&&<p>Code: {item.code}</p>}
 {admin&&<><button disabled={busy} onClick={()=>edit(item)}>Edit</button> <button disabled={busy} onClick={()=>setRemoving(item)}>Delete</button></>}
 </article>)}
 {removing&&<div className="card" role="alert"><p>Delete “{removing.name}”? This cannot be undone. Records with dependents cannot be deleted.</p><button disabled={busy} onClick={remove}>Confirm delete</button> <button disabled={busy} onClick={()=>setRemoving(null)}>Cancel</button></div>}
 <button disabled={busy||offset===0} onClick={()=>setOffset(v=>Math.max(0,v-25))}>Previous</button> <button disabled={busy||items.length<25} onClick={()=>setOffset(v=>v+25)}>Next</button><p>Page {Math.floor(offset/25)+1}</p>
 </div></div>}
 </section>;
}
