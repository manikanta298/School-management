import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='timetable-test-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const hash=await hashPassword('TimetablePassword!123'),accounts={},tokens={},ids={};const insert=async(sql,params)=>(await query(sql,params)).rows[0].id;
for(const [key,role] of [['admin','admin'],['t1','teacher'],['t2','teacher'],['t3','teacher'],['s1','student'],['s2','student'],['s3','student'],['parent','parent'],['outsider','parent']]){
 accounts[key]=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key}@example.com`,hash,role]);const r=await request(app).post('/api/auth/login').send({email:`${key}@example.com`,password:'TimetablePassword!123'});assert.equal(r.status,200);tokens[key]=r.body.accessToken;
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
test('room setup, slot validation and exact section/teacher/room conflicts',async()=>{
 let r=await request(app).get('/api/timetable/slots');assert.equal(r.status,401);
 for(const key of ['r1','r2']){r=await call('post','/rooms',{name:key,location:'Main building',active:true});assert.equal(r.status,201);ids[key]=r.body.item.id;}
 r=await call('post','/rooms',{name:'R1'});assert.equal(r.status,409);
 r=await call('post','/slots',slot());assert.equal(r.status,201);ids.base=r.body.item.id;assert.equal(r.body.item.start_time,'09:00');assert.equal(r.body.item.version,1);
 for(const extra of [{assignment_id:ids.a2,room_id:ids.r2,start_time:'09:30',end_time:'10:30'},{section_id:ids.b,room_id:ids.r2},{section_id:ids.c,assignment_id:ids.a4},{section_id:ids.d,assignment_id:ids.a3,room_id:ids.r2}]){r=await call('post','/slots',slot(extra));assert.equal(r.status,409);}
 r=await call('post','/slots',slot({assignment_id:ids.a2,start_time:'10:00',end_time:'11:00'}));assert.equal(r.status,201);ids.adjacent=r.body.item.id;
 r=await call('post','/slots',slot({section_id:ids.c,assignment_id:ids.a4,weekday:2}));assert.equal(r.status,201);ids.tuesday=r.body.item.id;
 r=await call('post','/slots',slot({section_id:ids.c,assignment_id:ids.a4,weekday:3,room_id:null}));assert.equal(r.status,201);
 r=await call('post','/slots',slot({section_id:ids.d,assignment_id:ids.a3,weekday:3,room_id:null}));assert.equal(r.status,201);
 r=await call('post','/slots',slot({section_id:ids.c,assignment_id:ids.a4,weekday:6,start_time:'23:00',end_time:'24:00',room_id:null}));assert.equal(r.status,201);assert.equal(r.body.item.end_time,'24:00');
 for(const extra of [{start_time:'24:00'},{end_time:'09:00'},{start_time:'09:60'},{weekday:0},{effective_from:'2025-02-30'},{effective_from:'2025-10-01',effective_to:'2025-09-01'},{assignment_id:ids.advisor},{section_id:ids.c,assignment_id:ids.a5,weekday:5}]){r=await call('post','/slots',slot(extra));assert.equal(r.status,400);}
 r=await call('post','/slots',slot({section_id:ids.c}));assert.equal(r.status,409);
});
test('date-limited recurrences avoid false conflicts and calendar weeks are exact',async()=>{
 let r=await call('post','/slots',slot({effective_from:'2025-10-06',effective_to:'2025-10-08'}));assert.equal(r.status,201);ids.narrow1=r.body.item.id;
 r=await call('post','/slots',slot({effective_from:'2025-10-07',effective_to:'2025-10-13'}));assert.equal(r.status,201);ids.narrow2=r.body.item.id;
 r=await call('post','/slots',slot({effective_from:'2025-10-07',effective_to:'2025-10-08'}));assert.equal(r.status,400);
 r=await call('get',`/slots?week_start=2025-10-06&section_id=${ids.a}`);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].id,ids.narrow1);
 r=await call('get',`/slots?week_start=2025-10-13&section_id=${ids.a}`);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].id,ids.narrow2);
 r=await call('get','/slots?week_start=2025-09-02');assert.equal(r.status,400);
 r=await call('get','/calendar',undefined,'s1');assert.equal(new Date(r.body.week_start+'T00:00:00Z').getUTCDay(),1);
});
test('teacher and family schedule scopes cannot be broadened by IDs or filters',async()=>{
 let r=await call('get','/slots?week_start=2025-09-01',undefined,'t1');assert.equal(r.status,200);assert.equal(r.body.items.length,2);assert.equal(r.body.items.every(s=>s.teacher_id===ids.t1),true);assert.equal(r.body.items[0].email,undefined);assert.equal(r.body.items[0].created_by,undefined);
 for(const who of ['s1','parent']){r=await call('get','/slots?week_start=2025-09-01',undefined,who);assert.equal(r.body.items.length,2);assert.equal(r.body.items.every(s=>s.section_id===ids.a),true);}
 r=await call('get','/slots?week_start=2025-09-01',undefined,'outsider');assert.deepEqual(r.body.items,[]);
 r=await call('get',`/slots?week_start=2025-09-01&student_id=${ids.s2}`,undefined,'parent');assert.deepEqual(r.body.items,[]);
 for(const who of ['s3','t2','outsider']){r=await call('get',`/slots/${ids.base}`,undefined,who);assert.equal(r.status,404);}
 r=await call('get',`/slots?student_id=${ids.s1}`,undefined,'t1');assert.equal(r.status,403);
 for(const who of ['t1','s1','parent']){
  r=await call('get','/rooms',undefined,who);assert.equal(r.status,403);
  r=await call('get',`/slots/${ids.base}/audit`,undefined,who);assert.equal(r.status,403);
  r=await call('post','/slots',slot(),who);assert.equal(r.status,403);
 }
 r=await call('get','/slots?include_inactive=true',undefined,'s1');assert.equal(r.status,403);
});
test('stale updates, deactivation/reactivation and append-only audits',async()=>{
 let r=await call('put',`/slots/${ids.base}`,slot({start_time:'11:00',end_time:'12:00',expected_version:1,change_note:'Move after assembly'}));assert.equal(r.status,200);assert.equal(r.body.item.version,2);
 r=await call('put',`/slots/${ids.base}`,slot({expected_version:1}));assert.equal(r.status,409);
 r=await call('post',`/slots/${ids.base}/deactivate`,{expected_version:2,reason:'x'});assert.equal(r.status,400);
 r=await call('post',`/slots/${ids.base}/deactivate`,{expected_version:2,reason:'Replace this weekly period'});assert.equal(r.status,200);assert.equal(r.body.item.version,3);
 r=await call('get',`/slots/${ids.base}`,undefined,'s1');assert.equal(r.status,404);
 r=await call('post','/slots',slot({assignment_id:ids.a2}));assert.equal(r.status,201);ids.replacement=r.body.item.id;
 r=await call('put',`/slots/${ids.base}`,slot({expected_version:3}));assert.equal(r.status,409);
 r=await call('put',`/slots/${ids.base}`,slot({start_time:'12:00',end_time:'13:00',expected_version:3,change_note:'Reinstate at another time'}));assert.equal(r.status,200);assert.equal(r.body.item.version,4);
 r=await call('get',`/slots/${ids.base}/audit`);assert.equal(r.status,200);assert.equal(r.body.items.length,4);assert.equal(r.body.items[0].action,'reactivated');assert.equal(r.body.items[0].previous_values.start_minute,660);assert.equal(r.body.items[0].new_values.start_minute,720);
 await assert.rejects(query("UPDATE timetable_audit SET note='rewrite'"),e=>e.code==='23514');
 await assert.rejects(query('DELETE FROM timetable_slots WHERE id=$1',[ids.base]),e=>e.code==='23503');
});
test('assignment history detaches safely and availability/family changes take effect',async()=>{
 let r=await request(app).delete(`/api/teachers/${ids.t1}/assignments/${ids.a1}`).set('Authorization',`Bearer ${tokens.admin}`);assert.equal(r.status,409);
 await assert.rejects(query('UPDATE teacher_assignments SET subject_id=$1 WHERE id=$2',[ids.art,ids.a1]),e=>e.code==='23503');
 await assert.rejects(query("UPDATE teachers SET joining_date='2025-09-15' WHERE id=$1",[ids.t1]),e=>e.code==='23514');
 await assert.rejects(query("UPDATE academic_years SET end_date='2025-09-10' WHERE id=$1",[ids.y1]),e=>e.code==='23514');
 await assert.rejects(query("UPDATE academic_years SET end_date='2025-09-10' WHERE id=$1",[ids.y2]),e=>e.code==='23514');
 const {rows:slots}=await query('SELECT id,version FROM timetable_slots WHERE assignment_id=$1 AND active',[ids.a1]);for(const s of slots){r=await call('post',`/slots/${s.id}/deactivate`,{expected_version:s.version,reason:'Replace departing teacher'});assert.equal(r.status,200);}
 r=await request(app).delete(`/api/teachers/${ids.t1}/assignments/${ids.a1}`).set('Authorization',`Bearer ${tokens.admin}`);assert.equal(r.status,204);
 r=await call('get',`/slots/${ids.base}`);assert.equal(r.body.item.assignment_id,null);assert.equal(r.body.item.active,false);assert.equal(r.body.item.version,6);
 r=await call('get',`/slots/${ids.base}/audit`);assert.equal(r.body.items[0].action,'detached');assert.equal(r.body.items[0].actor_name,'System (assignment removed)');
 await query("UPDATE teachers SET employment_status='inactive' WHERE id=$1",[ids.t2]);
 r=await call('get','/slots?week_start=2025-09-01',undefined,'t2');assert.deepEqual(r.body.items,[]);
 r=await call('get','/slots?week_start=2025-09-01',undefined,'parent');assert.equal(r.body.items.every(s=>!s.teacher_available),true);assert.equal(r.body.items.length,2);
 r=await call('post','/slots',slot({assignment_id:ids.a2,start_time:'14:00',end_time:'15:00'}));assert.equal(r.status,400);
 r=await call('put',`/rooms/${ids.r1}`,{name:'r1',location:'Main building',active:false,expected_version:1});assert.equal(r.status,200);
 r=await call('put',`/rooms/${ids.r1}`,{name:'r1',location:null,active:true,expected_version:1});assert.equal(r.status,409);
 r=await call('get','/slots?week_start=2025-09-01',undefined,'parent');assert.equal(r.body.items.every(s=>!s.room_available),true);
 r=await call('post','/slots',slot({section_id:ids.d,assignment_id:ids.a3,weekday:4,start_time:'14:00',end_time:'15:00'}));assert.equal(r.status,400);
 await query('UPDATE enrollments SET section_id=$1 WHERE id=$2',[ids.b,ids.s1enrollment]);
 r=await call('get','/slots?week_start=2025-09-01',undefined,'parent');assert.deepEqual(r.body.items,[]);
 await query('UPDATE enrollments SET section_id=$1 WHERE id=$2',[ids.a,ids.s1enrollment]);
 await query('DELETE FROM student_parents WHERE student_id=$1 AND parent_id=$2',[ids.s1,ids.parent]);
 r=await call('get','/slots?week_start=2025-09-01',undefined,'parent');assert.deepEqual(r.body.items,[]);
 await query("UPDATE enrollments SET status='withdrawn' WHERE id=$1",[ids.s1enrollment]);
 r=await call('get','/slots?week_start=2025-09-01',undefined,'s1');assert.deepEqual(r.body.items,[]);
});
test('paging and query validation preserve administrative history access',async()=>{
 const {rows:[cal]}=await query('SELECT * FROM timetable_slots LIMIT 1');assert.ok(cal.id);
 let r=await call('get','/slots?include_inactive=true&limit=1');assert.equal(r.status,200);assert.equal(r.body.items.length,1);
 const first=r.body.items[0].id;r=await call('get','/slots?include_inactive=true&limit=1&offset=1');assert.equal(r.body.items.length,1);assert.notEqual(r.body.items[0].id,first);
 for(const path of ['/slots?limit=101','/slots?weekday=8','/slots?week_start=2025-02-30','/slots/not-a-uuid']){r=await call('get',path);assert.equal(r.status,400);}
 r=await call('get','/assignments');assert.equal(r.status,200);assert.equal(r.body.items.every(a=>a.subject_id),true);
});
