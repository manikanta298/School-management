import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='timetable-test-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const schoolA=(await query("SELECT id FROM schools WHERE slug='existing-school'")).rows[0].id;
// Fixtures default to the initial school; second-school rows pass school_id explicitly.
for(const {table_name} of (await query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='school_id' AND table_name NOT IN ('school_memberships')")).rows)await query(`ALTER TABLE ${table_name} ALTER COLUMN school_id SET DEFAULT '${schoolA}'`);
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const hash=await hashPassword('TimetablePassword!123'),accounts={},tokens={},ids={};const insert=async(sql,params)=>(await query(sql,params)).rows[0].id;
for(const [key,role] of [['admin','admin'],['t1','teacher'],['t2','teacher'],['t3','teacher'],['s1','student'],['s2','student'],['s3','student'],['parent','parent'],['outsider','parent']]){
 accounts[key]=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key}@example.com`,hash,role]);await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolA,accounts[key],role]);const r=await request(app).post('/api/auth/login').send({email:`${key}@example.com`,password:'TimetablePassword!123'});assert.equal(r.status,200);tokens[key]=r.body.accessToken;
}
for(const [key,start,end] of [['y1','2025-06-01','2026-05-31'],['y2','2025-09-01','2026-08-31']])ids[key]=await insert('INSERT INTO academic_years(name,start_date,end_date) VALUES($1,$2,$3) RETURNING id',[key,start,end]);
for(const [key,y] of [['c1','y1'],['c2','y1'],['c3','y2']])ids[key]=await insert('INSERT INTO classes(name,academic_year_id) VALUES($1,$2) RETURNING id',[key,ids[y]]);
for(const [key,cl] of [['a','c1'],['b','c1'],['c','c2'],['d','c3']])ids[key]=await insert('INSERT INTO sections(name,class_id,capacity) VALUES($1,$2,40) RETURNING id',[key,ids[cl]]);
for(const key of ['math','science','art'])ids[key]=await insert('INSERT INTO subjects(name,code) VALUES($1,$2) RETURNING id',[key,key.toUpperCase()]);
for(const key of ['t1','t2','t3'])ids[key]=await insert('INSERT INTO teachers(user_id,employee_number,joining_date) VALUES($1,$2,$3) RETURNING id',[accounts[key],key.toUpperCase(),key==='t3'?'2025-10-01':'2020-01-01']);
for(const [key,t,cl,y,sub] of [['a1','t1','c1','y1','math'],['a2','t2','c1','y1','science'],['a3','t1','c3','y2','math'],['a4','t2','c2','y1','science'],['a5','t3','c2','y1','art'],['advisor','t3','c1','y1',null]])ids[key]=await insert('INSERT INTO teacher_assignments(teacher_id,class_id,academic_year_id,kind,subject_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[ids[t],ids[cl],ids[y],sub?'subject_teacher':'class_teacher',sub?ids[sub]:null]);
for(const [key,sec,cl] of [['s1','a','c1'],['s2','c','c2'],['s3','b','c1']]){ids[key]=await insert('INSERT INTO students(user_id,admission_number,admission_date) VALUES($1,$2,$3) RETURNING id',[accounts[key],key.toUpperCase(),'2025-01-01']);ids[key+'enrollment']=await insert('INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,$5) RETURNING id',[ids[key],ids.y1,ids[cl],ids[sec],'2025-06-01']);}
ids.parent=await insert('INSERT INTO parents(user_id) VALUES($1) RETURNING id',[accounts.parent]);await query("INSERT INTO student_parents(student_id,parent_id,relationship) VALUES($1,$2,'guardian')",[ids.s1,ids.parent]);
const call=(method,path,body,who='admin')=>{const r=request(app)[method]('/api/timetable'+path).set('Authorization',`Bearer ${tokens[who]}`);return body?r.send(body):r;};
const slot=(extra={})=>({section_id:ids.a,assignment_id:ids.a1,room_id:ids.r1,weekday:1,start_time:'09:00',end_time:'10:00',effective_from:'2025-09-01',effective_to:'2025-09-30',active:true,change_note:null,...extra});
after(async()=>{await db.close();await pool.end();});
// Separate file so the isolation checks get their own request-rate window.
test('timetables are isolated between schools and cannot reference another school',async()=>{
 const {rows:[sb]}=await query("INSERT INTO schools(name,slug) VALUES('School B','school-b') RETURNING id");const schoolB=sb.id;
 const mk=async(name,role)=>{const id=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[name,`${name}@example.com`,hash,role]);await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolB,id,role]);return id;};
 const adminB=await mk('adminb','admin'),teacherBUser=await mk('teacherb','teacher');
 let r=await request(app).post('/api/auth/login').send({email:'adminb@example.com',password:'TimetablePassword!123'});assert.equal(r.status,200);tokens.adminB=r.body.accessToken;
 const yearB=await insert('INSERT INTO academic_years(school_id,name,start_date,end_date) VALUES($1,$2,$3,$4) RETURNING id',[schoolB,'B year','2025-06-01','2026-05-31']);
 const classB=await insert('INSERT INTO classes(school_id,name,academic_year_id) VALUES($1,$2,$3) RETURNING id',[schoolB,'B1',yearB]);
 const sectionB=await insert('INSERT INTO sections(school_id,name,class_id,capacity) VALUES($1,$2,$3,40) RETURNING id',[schoolB,'A',classB]);
 const subjectB=await insert('INSERT INTO subjects(school_id,name,code) VALUES($1,$2,$3) RETURNING id',[schoolB,'maths-b','MB']);
 const teacherB=await insert('INSERT INTO teachers(school_id,user_id,employee_number,joining_date) VALUES($1,$2,$3,$4) RETURNING id',[schoolB,teacherBUser,'TB1','2020-01-01']);
 const assignmentB=await insert("INSERT INTO teacher_assignments(school_id,teacher_id,class_id,academic_year_id,kind,subject_id) VALUES($1,$2,$3,$4,'subject_teacher',$5) RETURNING id",[schoolB,teacherB,classB,yearB,subjectB]);
 // School A room and slot to attack.
 r=await call('post','/rooms',{name:'Lab',location:'Main',active:true});assert.equal(r.status,201);const roomA=r.body.item.id;
 r=await call('post','/slots',slot({room_id:roomA}));assert.equal(r.status,201,JSON.stringify(r.body));const slotA=r.body.item.id;
 // School B admin sees nothing of School A.
 r=await call('get','/rooms',undefined,'adminB');assert.deepEqual(r.body.items,[]);
 r=await call('get','/slots?include_inactive=true',undefined,'adminB');assert.deepEqual(r.body.items,[]);
 r=await call('get','/assignments',undefined,'adminB');assert.deepEqual(r.body.items.map(i=>i.id),[assignmentB]);
 for(const [m,path,body] of [['get',`/slots/${slotA}`],['get',`/slots/${slotA}/audit`],['put',`/slots/${slotA}`,{...slot({room_id:roomA}),expected_version:1}],['post',`/slots/${slotA}/deactivate`,{reason:'cross school',expected_version:1}]]){r=await call(m,path,body,'adminB');assert.equal(r.status,404,`${m} ${path}`);}
 r=await call('put',`/rooms/${roomA}`,{name:'Hijack',location:null,active:true,expected_version:1},'adminB');assert.equal(r.status,409);
 // Cross-school references in create are rejected.
 r=await call('post','/slots',slot({section_id:sectionB,assignment_id:ids.a1}),'adminB');assert.equal(r.status,404);
 r=await call('post','/slots',slot({section_id:ids.a,assignment_id:assignmentB}),'adminB');assert.equal(r.status,404);
 r=await call('post','/slots',slot({section_id:sectionB,assignment_id:assignmentB,room_id:roomA}),'adminB');assert.equal(r.status,404);
 // School B can reuse the room name, and the same weekday/time never conflicts with School A.
 r=await call('post','/rooms',{name:'Lab',location:'B block',active:true},'adminB');assert.equal(r.status,201);const roomB=r.body.item.id;
 r=await call('post','/slots',slot({section_id:sectionB,assignment_id:assignmentB,room_id:roomB}),'adminB');assert.equal(r.status,201,JSON.stringify(r.body));const slotB=r.body.item.id;
 // Conflicts still apply inside a school.
 r=await call('post','/slots',slot({section_id:sectionB,assignment_id:assignmentB,room_id:roomB}),'adminB');assert.equal(r.status,409);
 r=await call('get','/slots',undefined,'adminB');assert.deepEqual(r.body.items.map(i=>i.id),[slotB]);
 r=await call('get',`/slots/${slotB}`);assert.equal(r.status,404);
 r=await call('get',`/slots/${slotB}/audit`,undefined,'adminB');assert.equal(r.body.items.length,1);
 r=await call('get',`/slots/${slotA}`);assert.equal(r.status,200);assert.equal(r.body.item.version,1);
 r=await call('get','/rooms');assert.deepEqual(r.body.items.map(i=>i.id),[roomA]);
 // Database-level guards reject cross-school rows even when written directly.
 await assert.rejects(query("INSERT INTO timetable_slots(school_id,section_id,class_id,academic_year_id,assignment_id,teacher_id,subject_id,room_id,weekday,start_minute,end_minute,effective_from,effective_to,active,created_by,changed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,2,540,600,'2025-09-01','2025-09-30',true,$9,$9)",[schoolB,sectionB,classB,yearB,assignmentB,teacherB,subjectB,roomA,adminB]),/violates foreign key constraint "timetable_slots_room_same_school_fk"/);
 await assert.rejects(query("INSERT INTO school_rooms(school_id,name) VALUES($1,'lab')",[schoolB]),/duplicate key|unique/i);
});
