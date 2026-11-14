import React,{useEffect,useState} from 'react';
import {api} from '../api/client';
import {allPages} from '../api/pagination';
const blankVehicle={registration_number:'',capacity:'',driver_name:'',driver_phone:'',insurance_expiry:'',permit_expiry:'',active:true};
const statusNote=(label,status,date)=>status&&status!=='ok'?<span className="error"> {label} {status==='expired'?'expired':'expires'} {date}</span>:null;
function Allocations({admin,data,reload,busy,run}){
 const [form,setForm]=useState({student_id:'',stop_id:'',academic_year_id:''});
 const [students,setStudents]=useState([]),[years,setYears]=useState([]),[routes,setRoutes]=useState([]);
 useEffect(()=>{if(!admin)return;Promise.all([allPages('/students'),allPages('/academic/academic-years'),allPages('/transport/routes')]).then(([s,y,r])=>{setStudents(s);setYears(y);setRoutes(r);}).catch(()=>{});},[admin,data.length]);
 const stops=routes.flatMap(r=>r.stops.map(s=>({id:s.id,label:`${r.name} · ${s.sequence}. ${s.name}`})));
 return <div className="grid">{admin&&<form className="card" onSubmit={e=>{e.preventDefault();run(async()=>{await api('/transport/allocations',{method:'POST',body:form});setForm({student_id:'',stop_id:'',academic_year_id:''});},'Student allocated.');}}><h2>Allocate a student</h2>
 <label>Student<select required value={form.student_id} onChange={e=>setForm({...form,student_id:e.target.value})}><option value="">Select student</option>{students.map(s=><option key={s.id} value={s.id}>{s.name} · {s.admission_number}</option>)}</select></label>
 <label>Academic year<select required value={form.academic_year_id} onChange={e=>setForm({...form,academic_year_id:e.target.value})}><option value="">Select year</option>{years.map(y=><option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
 <label>Pickup stop<select required value={form.stop_id} onChange={e=>setForm({...form,stop_id:e.target.value})}><option value="">Select stop</option>{stops.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
 <button disabled={busy}>Allocate</button></form>}
 <div><h2>{admin?'Allocations':'Transport details'}</h2>{!data.length&&<p>No transport allocation.</p>}{data.map(a=><article className="card" key={a.id}><h3>{a.student_name} · {a.admission_number}</h3><p>{a.route_name} · stop {a.stop_sequence}: {a.stop_name}</p><p>Vehicle {a.vehicle_registration||'not assigned'}{a.driver_name?` · Driver ${a.driver_name} ${a.driver_phone||''}`:''}</p>{admin&&<button disabled={busy} onClick={()=>run(()=>api(`/transport/allocations/${a.id}`,{method:'DELETE'}),'Allocation removed.')}>Remove</button>}</article>)}</div></div>;
}
export default function Transport({user}){
 const admin=user.role==='admin';
 const [tab,setTab]=useState(admin?'vehicles':'allocations'),[vehicles,setVehicles]=useState([]),[routes,setRoutes]=useState([]),[allocations,setAllocations]=useState([]),[vehicle,setVehicle]=useState(blankVehicle),[editing,setEditing]=useState(null),[route,setRoute]=useState({name:'',vehicle_id:'',active:true}),[stop,setStop]=useState({route:'',name:'',sequence:''}),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  Promise.all([admin?allPages('/transport/vehicles'):[],admin?allPages('/transport/routes'):[],allPages('/transport/allocations')]).then(([v,r,a])=>{if(active){setVehicles(v);setRoutes(r);setAllocations(a);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[admin,revision]);
 async function run(fn,message){setBusy(true);setError('');setNotice('');try{await fn();setRevision(v=>v+1);setNotice(message);}catch(e){setError(e.message);}finally{setBusy(false);}}
 const orNull=v=>v===''?null:v;
 const saveVehicle=e=>{e.preventDefault();run(async()=>{await api(editing?`/transport/vehicles/${editing}`:'/transport/vehicles',{method:editing?'PUT':'POST',body:{...vehicle,capacity:Number(vehicle.capacity),driver_name:orNull(vehicle.driver_name),driver_phone:orNull(vehicle.driver_phone),insurance_expiry:orNull(vehicle.insurance_expiry),permit_expiry:orNull(vehicle.permit_expiry)}});setVehicle(blankVehicle);setEditing(null);},'Vehicle saved.');};
 const saveRoute=e=>{e.preventDefault();run(async()=>{await api('/transport/routes',{method:'POST',body:{...route,vehicle_id:orNull(route.vehicle_id)}});setRoute({name:'',vehicle_id:'',active:true});},'Route saved.');};
 const saveStop=e=>{e.preventDefault();run(async()=>{await api(`/transport/routes/${stop.route}/stops`,{method:'POST',body:{name:stop.name,sequence:Number(stop.sequence)}});setStop({route:stop.route,name:'',sequence:''});},'Stop added.');};
 const set=(setter,obj)=>key=>e=>setter({...obj,[key]:e.target.value});
 return <section><h1>Transport</h1>{admin&&<nav aria-label="Transport views">{['vehicles','routes','allocations'].map(t=><button key={t} aria-pressed={tab===t} disabled={busy} onClick={()=>setTab(t)}>{t}</button>)}</nav>}
 {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}{loading&&<p role="status">Loading transport…</p>}
 {!loading&&tab==='vehicles'&&admin&&<div className="grid"><form className="card" onSubmit={saveVehicle}><h2>{editing?'Edit':'Register'} vehicle</h2>
 <label>Registration number<input required value={vehicle.registration_number} onChange={set(setVehicle,vehicle)('registration_number')}/></label><label>Seat capacity<input required type="number" min="1" max="200" value={vehicle.capacity} onChange={set(setVehicle,vehicle)('capacity')}/></label>
 <label>Driver name<input value={vehicle.driver_name} onChange={set(setVehicle,vehicle)('driver_name')}/></label><label>Driver phone<input value={vehicle.driver_phone} onChange={set(setVehicle,vehicle)('driver_phone')}/></label>
 <label>Insurance expiry<input type="date" value={vehicle.insurance_expiry} onChange={set(setVehicle,vehicle)('insurance_expiry')}/></label><label>Permit expiry<input type="date" value={vehicle.permit_expiry} onChange={set(setVehicle,vehicle)('permit_expiry')}/></label>
 <label>Active<input className="check" type="checkbox" checked={vehicle.active} onChange={e=>setVehicle({...vehicle,active:e.target.checked})}/></label><button disabled={busy}>Save vehicle</button> {editing&&<button type="button" onClick={()=>{setEditing(null);setVehicle(blankVehicle);}}>Cancel edit</button>}</form>
 <div><h2>Vehicles</h2>{!vehicles.length&&<p>No vehicles yet.</p>}{vehicles.map(v=><article className="card" key={v.id}><h3>{v.registration_number} · {v.capacity} seats{v.active?'':' (inactive)'}</h3><p>{v.driver_name||'No driver'} {v.driver_phone||''}</p><p>{statusNote('Insurance',v.insurance_status,v.insurance_expiry)}{statusNote('Permit',v.permit_status,v.permit_expiry)}</p><button disabled={busy} onClick={()=>{setEditing(v.id);setVehicle({registration_number:v.registration_number,capacity:String(v.capacity),driver_name:v.driver_name||'',driver_phone:v.driver_phone||'',insurance_expiry:v.insurance_expiry||'',permit_expiry:v.permit_expiry||'',active:v.active});}}>Edit</button></article>)}</div></div>}
 {!loading&&tab==='routes'&&admin&&<div className="grid"><div><form className="card" onSubmit={saveRoute}><h2>Add route</h2><label>Name<input required value={route.name} onChange={set(setRoute,route)('name')}/></label><label>Vehicle<select value={route.vehicle_id} onChange={set(setRoute,route)('vehicle_id')}><option value="">No vehicle</option>{vehicles.map(v=><option key={v.id} value={v.id}>{v.registration_number}</option>)}</select></label><button disabled={busy}>Save route</button></form>
 <form className="card" onSubmit={saveStop}><h2>Add stop</h2><label>Route<select required value={stop.route} onChange={set(setStop,stop)('route')}><option value="">Select route</option>{routes.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label>Stop name<input required value={stop.name} onChange={set(setStop,stop)('name')}/></label><label>Order<input required type="number" min="1" max="200" value={stop.sequence} onChange={set(setStop,stop)('sequence')}/></label><button disabled={busy}>Add stop</button></form></div>
 <div><h2>Routes</h2>{!routes.length&&<p>No routes yet.</p>}{routes.map(r=><article className="card" key={r.id}><h3>{r.name}</h3><p>Vehicle: {r.vehicle_registration||'none'}</p><ol>{r.stops.map(s=><li key={s.id}>{s.name} <button disabled={busy} onClick={()=>run(()=>api(`/transport/stops/${s.id}`,{method:'DELETE'}),'Stop removed.')}>Remove</button></li>)}</ol></article>)}</div></div>}
 {!loading&&tab==='allocations'&&<Allocations admin={admin} data={allocations} busy={busy} run={run}/>}</section>;
}
