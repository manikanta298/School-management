import React,{useState} from 'react';
import {GraduationCap,LayoutDashboard,Users,ContactRound,BookOpen,ClipboardCheck,CalendarDays,Award,Wallet,Megaphone,ShieldCheck,Settings2,LogOut,Menu,X,Bell,ArrowRight} from 'lucide-react';
export const navigationFor=role=>[
 {page:'dashboard',label:'Overview',Icon:LayoutDashboard},
 ...(role!=='teacher'?[{page:'students',label:role==='admin'?'Students & parents':role==='parent'?'My family':'My profile',Icon:Users}]:[]),
 ...(['admin','teacher'].includes(role)?[{page:'teachers',label:role==='admin'?'Teachers':'My teaching',Icon:ContactRound}]:[]),
 {page:'academic',label:'Academic setup',Icon:BookOpen},
 {page:'attendance',label:'Attendance',Icon:ClipboardCheck},
 {page:'timetable',label:'Timetable',Icon:CalendarDays},
 {page:'exams',label:'Exams & results',Icon:Award},
 ...(role!=='teacher'?[{page:'fees',label:role==='admin'?'Fees & invoices':'My fees',Icon:Wallet}]:[]),
 {page:'notices',label:'Notices',Icon:Megaphone},
 ...(role==='admin'?[{page:'users',label:'User accounts',Icon:ShieldCheck}]:[]),
 {page:'password',label:'Security',Icon:Settings2}
];
export default function AppShell({user,page,onNavigate,onLogout,busy,children}){
 const [open,setOpen]=useState(false);
 if(!user)return <div className="auth-shell"><header className="auth-brand"><GraduationCap size={28} aria-hidden="true"/><strong>School Management</strong></header><main id="main-content" className="auth-main"><div className="auth-intro"><span className="eyebrow">One connected school</span><h1>A clearer view.<br/>A better school day.</h1><p>One workspace for your school, teachers, students and families.</p><div className="auth-art" aria-hidden="true"><div/><div/><div/></div><span className="muted">Learning, connected.</span></div><div className="auth-form">{children}</div></main></div>;
 const nav=navigationFor(user.role),active=nav.find(n=>n.page===page);
 function go(target){onNavigate(target);setOpen(false);}
 return <div className="app-shell"><a href="#main-content" className="skip-link">Skip to main content</a><aside className={`sidebar ${open?'is-open':''}`} id="school-sidebar" onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}><div className="brand"><GraduationCap size={30} aria-hidden="true"/><span>School<small>MANAGEMENT</small></span><button className="icon-button sidebar-close" onClick={()=>setOpen(false)} aria-label="Close navigation"><X size={20}/></button></div><p className="nav-label">School workspace</p><nav className="sidebar-nav" aria-label="Main navigation">{nav.map(({page:target,label,Icon})=><button key={target} type="button" className={`nav-item ${target===page?'active':''}`} aria-current={target===page?'page':undefined} onClick={()=>go(target)}><Icon size={18} aria-hidden="true"/><span>{label}</span></button>)}</nav><div className="sidebar-user"><span className="avatar" aria-hidden="true">{user.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</span><span><strong>{user.name}</strong><small>{user.role} workspace</small></span></div><button className="nav-item signout" onClick={onLogout} disabled={busy}><LogOut size={17} aria-hidden="true"/>Sign out</button></aside><div className="workspace"><header className="workspace-header"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Toggle navigation" aria-expanded={open} aria-controls="school-sidebar" onClick={()=>setOpen(v=>!v)}><Menu size={21}/></button><span>Workspace</span><span aria-hidden="true">/</span><strong>{active?.label||'Overview'}</strong></div><div className="header-actions"><span className="workspace-role">{user.role} workspace</span><button className="icon-button" aria-label="Open notices" onClick={()=>go('notices')}><Bell size={19}/></button><span className="avatar" aria-hidden="true">{user.name[0]}</span></div></header><main id="main-content" className="workspace-main" tabIndex={-1}>{children}</main><footer className="workspace-footer"><span>School Management</span><span>One connected school <ArrowRight size={13} aria-hidden="true"/></span></footer></div></div>;
}
