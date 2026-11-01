import React,{useEffect,useState} from 'react';
import { createRoot } from 'react-dom/client';
import { api,restore,clearToken } from './api/client';
import './style.css';
import AcademicSetup from './pages/AcademicSetup';
import StudentsParents from './pages/StudentsParents';
import Teachers from './pages/Teachers';
import Attendance from './pages/Attendance';
import Fees from './pages/Fees';
import Exams from './pages/Exams';
import Timetable from './pages/Timetable';
function App(){
 const [user,setUser]=useState(null),[loading,setLoading]=useState(true),[page,setPage]=useState('dashboard'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[users,setUsers]=useState([]),[offset,setOffset]=useState(0);
 useEffect(()=>{restore().then(d=>setUser(d.user)).catch(()=>{}).finally(()=>setLoading(false));},[]);
 async function loadUsers(start=0){const d=await api(`/users?limit=25&offset=${start}`);setUsers(d.users);setOffset(start);}
 async function run(fn){setError('');setNotice('');setBusy(true);try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function login(e){e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));await run(async()=>{const d=await api('/auth/login',{method:'POST',body});setUser(d.user);setPage('dashboard');});}
 async function logout(){await run(async()=>{await api('/auth/logout',{method:'POST'});clearToken();setUser(null);setUsers([]);});}
 async function change(e){e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));await run(async()=>{await api('/auth/change-password',{method:'POST',body});clearToken();setUser(null);setNotice('Password changed. Sign in again.');});}
 async function create(e){e.preventDefault();const form=e.currentTarget,body=Object.fromEntries(new FormData(form));await run(async()=>{await api('/users',{method:'POST',body});form.reset();await loadUsers();setNotice('Account created. Share credentials securely.');});}
 async function reset(e,id){e.preventDefault();const form=e.currentTarget,body=Object.fromEntries(new FormData(form));await run(async()=>{await api(`/users/${id}/reset-password`,{method:'POST',body});form.reset();setNotice('Password reset. All sessions for this account were revoked.');});}
 const field=(name,label,type='text',minLength)=> <label>{label}<input name={name} type={type} required minLength={minLength} autoComplete={type==='password'?'new-password':undefined}/></label>;
 if(loading)return <main><p role="status">Loading your session…</p></main>;
 return <><header><strong>School Management</strong>{user&&<span>{user.name} · {user.role} <button onClick={logout} disabled={busy}>Sign out</button></span>}</header><main>
 {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
 {!user?<section className="login"><p className="eyebrow">SCHOOL PORTAL</p><h1>Welcome back</h1><p>Sign in with your school account.</p><form onSubmit={login}>{field('email','Email','email')}<label>Password<input name="password" type="password" required autoComplete="current-password"/></label><button disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form><p>Need an account or password reset? Contact your school administrator.</p></section>:<><nav><button onClick={()=>setPage('timetable')}>Timetable</button><button onClick={()=>setPage('exams')}>Exams & Results</button>{user.role!=='teacher'&&<button onClick={()=>setPage('fees')}>Fees</button>}<button onClick={()=>setPage('attendance')}>Attendance</button>{['admin','teacher'].includes(user.role)&&<button onClick={()=>setPage('teachers')}>{user.role==='admin'?'Teachers':'My teaching'}</button>}{user.role!=='teacher'&&<button onClick={()=>setPage('students')}>{user.role==='admin'?'Students & Parents':user.role==='parent'?'My family':'My profile'}</button>}<button onClick={()=>setPage('academic')}>Academic setup</button><button onClick={()=>setPage('dashboard')}>Dashboard</button><button onClick={()=>setPage('password')}>Change password</button>{user.role==='admin'&&<button onClick={()=>run(async()=>{await loadUsers();setPage('users');})}>Manage users</button>}</nav>
 {page==='timetable'&&<Timetable user={user}/>}
 {page==='exams'&&<Exams user={user}/>}
 {page==='fees'&&user.role!=='teacher'&&<Fees user={user}/>}
 {page==='attendance'&&<Attendance user={user}/>}
 {page==='teachers'&&['admin','teacher'].includes(user.role)&&<Teachers user={user}/>}
 {page==='students'&&user.role!=='teacher'&&<StudentsParents user={user}/>}
 {page==='academic'&&<AcademicSetup user={user}/>}
 {page==='dashboard'&&<section><p className="eyebrow">{user.role.toUpperCase()} PORTAL</p><h1>Hello, {user.name}</h1><p>Your account is ready. Use the navigation to view your academic and profile records.</p><div className="card"><h2>Account details</h2><p>{user.email}</p><p>Role: {user.role}</p></div></section>}
 {page==='password'&&<section><h1>Change password</h1><form onSubmit={change}>{field('currentPassword','Current password','password')}{field('newPassword','New password (12+ characters, maximum 72 UTF-8 bytes)','password',12)}<button disabled={busy}>Update password and sign out</button></form></section>}
 {page==='users'&&user.role==='admin'&&<section><h1>Manage users</h1><div className="grid"><div className="card"><h2>Create account</h2><form onSubmit={create}>{field('name','Full name')}{field('email','Email','email')}{field('password','Initial password (12+ characters)','password',12)}<label>Role<select name="role">{['teacher','student','parent','admin'].map(r=><option key={r}>{r}</option>)}</select></label><button disabled={busy}>Create account</button></form></div><div><h2>Accounts</h2>{users.map(u=><article className="card" key={u.id}><h3>{u.name}</h3><p>{u.email} · {u.role}</p><details><summary>Reset password</summary><form onSubmit={e=>reset(e,u.id)}>{field('newPassword','New password','password',12)}<button disabled={busy}>Reset and revoke sessions</button></form></details></article>)}<button disabled={busy||offset===0} onClick={()=>run(()=>loadUsers(Math.max(0,offset-25)))}>Previous</button> <button disabled={busy||users.length<25} onClick={()=>run(()=>loadUsers(offset+25))}>Next</button></div></div></section>}
 </> }</main></>;
}
createRoot(document.getElementById('root')).render(<App/>);
