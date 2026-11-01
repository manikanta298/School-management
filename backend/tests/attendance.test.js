import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='attendance-test-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const hash=await hashPassword('AttendancePassword!123'),accounts={},tokens={},ids={};
for(const [key,role] of [['admin','admin'],['classTeacher','teacher'],['subjectTeacher','teacher'],['otherTeacher','teacher'],['s1','student'],['s2','student'],['s3','student'],['parent','parent'],['outsider','parent']]){
 const {rows:[u]}=await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key.toLowerCase()}@example.com`,hash,role]);accounts[key]=u.id;
 const logged=await request(app).post('/api/auth/login').send({email:`${key.toLowerCase()}@example.com`,password:'AttendancePassword!123'});assert.equal(logged.status,200);tokens[key]=logged.body.accessToken;
}
const call=(method,path,body,who='admin')=>{const req=request(app)[method]('/api/'+path).set('Authorization',`Bearer ${tokens[who]}`);return body?req.send(body):req;};
const insert=async(sql,params)=>(await query(sql,params)).rows[0].id;
ids.year=await insert('INSERT INTO academic_years(name,start_date,end_date) VALUES($1,$2,$3) RETURNING id',['2025–2026','2025-06-01','2026-05-31']);
for(const key of ['c1','c2'])ids[key]=await insert('INSERT INTO classes(name,academic_year_id) VALUES($1,$2) RETURNING id',[key,ids.year]);
for(const [key,cl] of [['a','c1'],['b','c1'],['c','c2']])ids[key]=await insert('INSERT INTO sections(name,class_id,capacity) VALUES($1,$2,40) RETURNING id',[key,ids[cl]]);
ids.subject=await insert("INSERT INTO subjects(name,code) VALUES('Math','MATH') RETURNING id");
for(const [key,kind,cl] of [['classTeacher','class_teacher','c1'],['subjectTeacher','subject_teacher','c1'],['otherTeacher','class_teacher','c2']]){
 ids[key]=await insert('INSERT INTO teachers(user_id,employee_number,joining_date) VALUES($1,$2,$3) RETURNING id',[accounts[key],key.toUpperCase(),'2020-01-01']);
 ids[key+'assignment']=await insert('INSERT INTO teacher_assignments(teacher_id,class_id,academic_year_id,kind,subject_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[ids[key],ids[cl],ids.year,kind,kind==='subject_teacher'?ids.subject:null]);
}
for(const [key,sec,cl] of [['s1','a','c1'],['s2','a','c1'],['s3','c','c2']]){
 ids[key]=await insert('INSERT INTO students(user_id,admission_number,admission_date) VALUES($1,$2,$3) RETURNING id',[accounts[key],key.toUpperCase(),'2025-01-01']);
 ids[key+'enrollment']=await insert('INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,$5) RETURNING id',[ids[key],ids.year,ids[cl],ids[sec],'2025-06-01']);
}
ids.parent=await insert('INSERT INTO parents(user_id) VALUES($1) RETURNING id',[accounts.parent]);
await query("INSERT INTO student_parents(student_id,parent_id,relationship) VALUES($1,$2,'guardian')",[ids.s1,ids.parent]);
const daily=(sec='a',date='2025-09-01')=>`attendance/register?section_id=${ids[sec]}&date=${date}`;
const mark=(entries,expected_version=0,date='2025-09-01',sec='a',correction_reason=null)=>({section_id:ids[sec],date,expected_version,entries,correction_reason});
const entry=(key,status,note=null)=>({student_id:ids[key],status,note});
after(async()=>{await db.close();await pool.end();});
test('section permissions, non-mutating register reads and atomic first marks',async()=>{
 let r=await request(app).get('/api/attendance/sections');assert.equal(r.status,401);
 r=await call('get','attendance/calendar',undefined,'s1');assert.match(r.body.today,/^\d{4}-\d{2}-\d{2}$/);
 r=await call('get','attendance/sections',undefined,'classTeacher');assert.equal(r.status,200);assert.equal(r.body.items.length,2);assert.equal(r.body.items[0].can_mark,true);
 r=await call('get','attendance/sections',undefined,'subjectTeacher');assert.equal(r.body.items.length,2);assert.equal(r.body.items[0].can_mark,false);
 r=await call('get',daily(),undefined,'classTeacher');assert.equal(r.status,200);assert.equal(r.body.register,null);assert.equal(r.body.items.length,2);assert.equal(r.body.items[0].status,null);
 assert.equal((await query('SELECT * FROM attendance_registers')).rows.length,0);
 r=await call('get',daily(),undefined,'otherTeacher');assert.equal(r.status,404);
 for(const who of ['s1','parent']){r=await call('get',daily(),undefined,who);assert.equal(r.status,403);r=await call('put','attendance/register',mark([entry('s1','present')]),who);assert.equal(r.status,403);}
 r=await call('put','attendance/register',mark([entry('s1','present')]),'subjectTeacher');assert.equal(r.status,404);
 r=await call('put','attendance/register',mark([entry('s1','present'),entry('s3','absent')]),'classTeacher');assert.equal(r.status,400);assert.equal((await query('SELECT * FROM attendance_registers')).rows.length,0);assert.equal((await query('SELECT * FROM attendance_audit')).rows.length,0);
 r=await call('put','attendance/register',mark([entry('s1','present','On time'),entry('s2','absent')]),'classTeacher');assert.equal(r.status,200);assert.deepEqual(r.body,{version:1,changed:2});
 r=await call('get',daily(),undefined,'subjectTeacher');assert.equal(r.status,200);assert.equal(r.body.register.version,1);assert.equal(r.body.items[0].email,undefined);
 r=await call('put','attendance/register',mark([entry('s1','late')],0),'classTeacher');assert.equal(r.status,409);
 r=await call('put','attendance/register',mark([entry('s1','present','On time')],1),'classTeacher');assert.deepEqual(r.body,{version:1,changed:0});
});
test('corrections require reasons and audit history is protected',async()=>{
 let r=await call('put','attendance/register',mark([entry('s1','late','Bus delayed')],1),'classTeacher');assert.equal(r.status,400);
 r=await call('put','attendance/register',mark([entry('s1','late','Bus delayed')],1,'2025-09-01','a','Correct arrival time'),'classTeacher');assert.equal(r.status,200);assert.equal(r.body.version,2);
 r=await call('get',`attendance/audit?section_id=${ids.a}&date=2025-09-01`);assert.equal(r.status,200);assert.equal(r.body.items.length,3);assert.equal(r.body.items[0].reason,'Correct arrival time');assert.equal(r.body.items[0].previous_status,'present');assert.equal(r.body.items[0].new_status,'late');
 r=await call('get',`attendance/audit?section_id=${ids.a}&date=2025-09-01`,undefined,'classTeacher');assert.equal(r.status,403);
 await assert.rejects(query("UPDATE attendance_audit SET reason='rewrite'"),e=>e.code==='23514');
 await assert.rejects(query('DELETE FROM attendance_audit'),e=>e.code==='23514');
 r=await call('put','attendance/register',mark([entry('s1','void')],0,'2025-09-02'),'classTeacher');assert.equal(r.status,400);
 r=await call('put','attendance/register',mark([entry('s1','present','<script>')],0,'2025-09-02'),'classTeacher');assert.equal(r.status,400);
 r=await call('put','attendance/register',mark([entry('s1','present'),entry('s1','absent')],0,'2025-09-02'),'classTeacher');assert.equal(r.status,400);
 r=await call('put','attendance/register',mark([entry('s1','present')],0,'2099-01-01'),'classTeacher');assert.equal(r.status,400);
 r=await call('get',daily('a','2025-02-30'));assert.equal(r.status,400);
 r=await call('get',daily('a','2025-05-31'));assert.equal(r.status,400);
 r=await call('get',daily()+'&limit=101');assert.equal(r.status,400);
});
test('personal history, summaries and family scoping do not invent absences',async()=>{
 let r=await call('put','attendance/register',mark([entry('s1','excused')],0,'2025-09-02'),'classTeacher');assert.equal(r.status,200);
 const history=`attendance/students/${ids.s1}?from=2025-09-01&to=2025-09-30`;
 r=await call('get',history,undefined,'s1');assert.equal(r.status,200);assert.equal(r.body.items.length,2);assert.equal(r.body.summary.recorded_days,2);assert.equal(r.body.summary.late,1);assert.equal(r.body.summary.excused,1);assert.equal(Number(r.body.summary.attendance_percentage),100);assert.equal(r.body.summary.absent,0);
 r=await call('get',history,undefined,'parent');assert.equal(r.status,200);
 for(const who of ['s2','outsider']){r=await call('get',history,undefined,who);assert.equal(r.status,404);}
 r=await call('get',history,undefined,'classTeacher');assert.equal(r.status,403);
 const summary=`attendance/summary?section_id=${ids.a}&from=2025-09-01&to=2025-09-30`;
 r=await call('get',summary,undefined,'subjectTeacher');assert.equal(r.status,200);assert.equal(r.body.items.length,2);assert.equal(r.body.items.find(x=>x.student_id===ids.s2).absent,1);
 r=await call('get',summary,undefined,'otherTeacher');assert.equal(r.status,404);
 r=await call('get',`attendance/students/${ids.s2}?from=2025-09-01&to=2025-09-30`,undefined,'s2');assert.equal(Number(r.body.summary.attendance_percentage),0);
 r=await call('get',`attendance/students/${ids.s1}?from=2020-01-01&to=2025-09-30`);assert.equal(r.status,400);
 await query('DELETE FROM student_parents WHERE student_id=$1 AND parent_id=$2',[ids.s1,ids.parent]);
 r=await call('get',history,undefined,'parent');assert.equal(r.status,404);
});
test('transfers retain history, daily duplicates require voiding, dependencies stay protected',async()=>{
 await query('UPDATE enrollments SET section_id=$1 WHERE id=$2',[ids.b,ids.s1enrollment]);
 let r=await call('get',daily('a'),undefined,'classTeacher');assert.equal(r.body.items.some(e=>e.student_id===ids.s1),true);
 r=await call('get',daily('b'),undefined,'classTeacher');assert.equal(r.body.items.some(e=>e.student_id===ids.s1),false);
 r=await call('put','attendance/register',mark([entry('s1','present')],0,'2025-09-01','b'),'classTeacher');assert.equal(r.status,409);
 r=await call('put','attendance/register',mark([entry('s1','void','Wrong section')],2,'2025-09-01','a','Recorded in wrong section'),'classTeacher');assert.equal(r.status,200);assert.equal(r.body.version,3);
 r=await call('put','attendance/register',mark([entry('s1','present')],0,'2025-09-01','b'),'classTeacher');assert.equal(r.status,200);
 r=await call('put','attendance/register',mark([entry('s1','present')],3,'2025-09-01','a','Try to restore old mark'),'classTeacher');assert.equal(r.status,409);
 const history=`attendance/students/${ids.s1}?from=2025-09-01&to=2025-09-30`;
 r=await call('get',history,undefined,'s1');assert.equal(r.body.items.length,3);assert.equal(r.body.summary.voided,1);assert.equal(r.body.summary.recorded_days,2);
 await assert.rejects(query('DELETE FROM enrollments WHERE id=$1',[ids.s1enrollment]),e=>e.code==='23503');
 await assert.rejects(query('UPDATE enrollments SET enrolled_on=$1 WHERE id=$2',['2025-09-03',ids.s1enrollment]),e=>e.code==='23514');
 await assert.rejects(query('UPDATE academic_years SET end_date=$1 WHERE id=$2',['2025-08-31',ids.year]),e=>e.code==='23514');
 await query("UPDATE enrollments SET status='withdrawn' WHERE id=$1",[ids.s1enrollment]);
 r=await call('get',daily('b'),undefined,'classTeacher');assert.equal(r.body.items[0].student_id,ids.s1);
 r=await call('put','attendance/register',mark([entry('s1','absent')],0,'2025-09-03','b'),'classTeacher');assert.equal(r.status,400);
 r=await call('put','attendance/register',mark([entry('s1','late')],1,'2025-09-01','b','Arrival time corrected'),'classTeacher');assert.equal(r.status,200);
});
test('assignment removal and inactivity revoke attendance access immediately',async()=>{
 await query("UPDATE teachers SET employment_status='inactive' WHERE id=$1",[ids.classTeacher]);
 let r=await call('get','attendance/sections',undefined,'classTeacher');assert.deepEqual(r.body.items,[]);
 r=await call('get',daily(),undefined,'classTeacher');assert.equal(r.status,404);
 r=await call('put','attendance/register',mark([entry('s2','present')],3),'classTeacher');assert.equal(r.status,404);
 await query("UPDATE teachers SET employment_status='active' WHERE id=$1",[ids.classTeacher]);
 await query('DELETE FROM teacher_assignments WHERE id=$1',[ids.classTeacherassignment]);
 r=await call('get',daily(),undefined,'classTeacher');assert.equal(r.status,404);
 r=await call('get',daily(),undefined,'subjectTeacher');assert.equal(r.status,200);
 r=await call('put','attendance/register',mark([entry('s2','present')],3,'2025-09-01','a','Admin correction'));assert.equal(r.status,200);
});
test('register pagination, enrollment-date eligibility and joining-date limits',async()=>{
 for(let index=0;index<26;index++){
  const uid=await insert("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'student') RETURNING id",[`Extra ${index}`,`extra${index}@example.com`,hash]);
  const sid=await insert('INSERT INTO students(user_id,admission_number,admission_date) VALUES($1,$2,$3) RETURNING id',[uid,`EXTRA-${index}`,'2025-01-01']);
  await query('INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,$5)',[sid,ids.year,ids.c1,ids.a,'2025-09-10']);if(index===0)ids.extra=sid;
 }
 let r=await call('get',daily('a','2025-09-09'));assert.equal(r.body.items.length,1);
 r=await call('get',daily('a','2025-09-10'));assert.equal(r.body.items.length,25);
 r=await call('get',daily('a','2025-09-10')+'&offset=25');assert.equal(r.body.items.length,2);
 r=await call('put','attendance/register',mark([{student_id:ids.extra,status:'present'}],0,'2025-09-09'));assert.equal(r.status,400);
 await query('UPDATE teachers SET joining_date=$1 WHERE id=$2',['2025-09-11',ids.classTeacher]);
 await query("INSERT INTO teacher_assignments(teacher_id,class_id,academic_year_id,kind) VALUES($1,$2,$3,'class_teacher')",[ids.classTeacher,ids.c1,ids.year]);
 r=await call('put','attendance/register',mark([{student_id:ids.extra,status:'present'}],0,'2025-09-10'),'classTeacher');assert.equal(r.status,400);
 r=await call('put','attendance/register',mark([{student_id:ids.extra,status:'present'}],0,'2025-09-10'));assert.equal(r.status,200);
 await assert.rejects(query('UPDATE attendance_entries SET student_id=$1 WHERE student_id=$2',[ids.s3,ids.extra]),e=>e.code==='23514');
 await assert.rejects(query("UPDATE attendance_entries SET status='absent',change_reason=NULL WHERE student_id=$1",[ids.extra]),e=>e.code==='23514');
 const body=mark(Array.from({length:100},(_,i)=>({student_id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,status:'present',note:'漢'.repeat(200)})),0,'2025-09-12');
 r=await call('put','attendance/register',body);assert.equal(r.status,400);assert.notEqual(r.status,413); // Valid bounded JSON exceeds the general API's 16KB limit.
});
