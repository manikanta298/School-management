import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='teachers-test-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const password='TeachersPassword!123',hash=await hashPassword(password),accounts={},tokens={},ids={};
for(const [key,role] of [['admin','admin'],['t1','teacher'],['t2','teacher'],['t3','teacher'],['s1','student'],['s2','student'],['s3','student'],['parent','parent']]){
 const {rows:[u]}=await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key}@example.com`,hash,role]);accounts[key]=u.id;
 const logged=await request(app).post('/api/auth/login').send({email:`${key}@example.com`,password});assert.equal(logged.status,200);tokens[key]=logged.body.accessToken;
}
const call=(method,path,body,who='admin')=>{const req=request(app)[method]('/api/'+path).set('Authorization',`Bearer ${tokens[who]}`);return body?req.send(body):req;};
const profile=(key,status='active')=>({employee_number:`EMP-${key}`,joining_date:'2021-01-01',phone:'+91 98765 43210',qualification:'B.Ed',employment_status:status});
for(const key of ['y1','y2']){const {rows:[y]}=await query('INSERT INTO academic_years(name,start_date,end_date) VALUES($1,$2,$3) RETURNING id',[key,key==='y1'?'2025-06-01':'2020-01-01',key==='y1'?'2026-05-31':'2022-12-31']);ids[key]=y.id;}
for(const [key,year] of [['c1','y1'],['c2','y1'],['old','y2']]){const {rows:[cl]}=await query('INSERT INTO classes(name,academic_year_id) VALUES($1,$2) RETURNING id',[key,ids[year]]);ids[key]=cl.id;}
for(const [key,cl] of [['a','c1'],['b','c1'],['c','c2']]){const {rows:[s]}=await query('INSERT INTO sections(name,class_id,capacity) VALUES($1,$2,40) RETURNING id',[key,ids[cl]]);ids[key]=s.id;}
for(const [key,section,cl,status] of [['s1','a','c1','active'],['s2','b','c1','withdrawn'],['s3','c','c2','active']]){
 const {rows:[s]}=await query('INSERT INTO students(user_id,admission_number,admission_date,date_of_birth,address) VALUES($1,$2,$3,$4,$5) RETURNING id',[accounts[key],`ADM-${key.toUpperCase()}`,'2025-01-01','2015-01-01','PRIVATE ADDRESS']);ids[key]=s.id;
 await query('INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on,status) VALUES($1,$2,$3,$4,$5,$6)',[s.id,ids.y1,ids[cl],ids[section],'2025-06-01',status]);
}
for(const key of ['math','science']){const {rows:[s]}=await query('INSERT INTO subjects(name,code) VALUES($1,$2) RETURNING id',[key,key.toUpperCase()]);ids[key]=s.id;}
after(async()=>{await db.close();await pool.end();});
test('teacher profile CRUD and own-profile authorization',async()=>{
 let r=await request(app).get('/api/teachers');assert.equal(r.status,401);
 r=await call('post','teachers',{user_id:accounts.s1,...profile('wrong')});assert.equal(r.status,409);
 for(const key of ['t1','t2','t3']){r=await call('post','teachers',{user_id:accounts[key],...profile(key,key==='t3'?'inactive':'active')});assert.equal(r.status,201);ids[key]=r.body.item.id;assert.equal(r.body.item.password_hash,undefined);assert.equal(r.body.item.account_role,undefined);}
 r=await call('post','teachers',{user_id:accounts.t1,...profile('unique')});assert.equal(r.status,409);
 r=await call('get','teachers',undefined,'t1');assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].id,ids.t1);
 r=await call('get',`teachers/${ids.t2}`,undefined,'t1');assert.equal(r.status,404);
 r=await call('get',`teachers/${ids.t2}/assignments`,undefined,'t1');assert.equal(r.status,404);
 r=await call('get',`teachers/${ids.t1}/assignments`,undefined,'t1');assert.deepEqual(r.body.items,[]);
 for(const who of ['s1','parent']){for(const path of ['teachers',`teachers/${ids.t1}`]){r=await call('get',path,undefined,who);assert.equal(r.status,403);}}
 for(const [method,path,body] of [['post','teachers',{user_id:accounts.t1,...profile('t1')}],['put',`teachers/${ids.t1}`,profile('t1')],['delete',`teachers/${ids.t1}`,null]]){r=await call(method,path,body,'t1');assert.equal(r.status,403);}
 r=await call('put',`teachers/${ids.t1}`,{...profile('t1'),user_id:accounts.t2});assert.equal(r.status,400);
 r=await call('put',`teachers/${ids.t1}`,{...profile('t1'),qualification:'<script>'});assert.equal(r.status,400);
 r=await call('put',`teachers/${ids.t1}`,{...profile('t1'),joining_date:'2021-02-30'});assert.equal(r.status,400);
 r=await call('put',`teachers/${ids.t1}`,{...profile('t1'),joining_date:'2099-01-01'});assert.equal(r.status,400);
 r=await call('put',`teachers/${ids.t1}`,{...profile('t1'),phone:null,qualification:'M.Ed'});assert.equal(r.status,200);assert.equal(r.body.item.qualification,'M.Ed');
 r=await call('get','teachers?q=EMP-T1&limit=1');assert.equal(r.body.items.length,1);
 r=await call('get','teachers?q=%27%20OR%201%3D1--');assert.equal(r.body.items.length,0);
});
test('class/subject assignment uniqueness and minimal assigned roster access',async()=>{
 const advisor=cl=>({class_id:ids[cl],kind:'class_teacher'});
 const subject=(cl,sub)=>({class_id:ids[cl],kind:'subject_teacher',subject_id:ids[sub]});
 let r=await call('post',`teachers/${ids.t1}/assignments`,advisor('c1'));assert.equal(r.status,201);ids.advisor=r.body.item.id;
 r=await call('post',`teachers/${ids.t1}/assignments`,subject('c2','math'));assert.equal(r.status,201);ids.mathAssignment=r.body.item.id;
 r=await call('post',`teachers/${ids.t2}/assignments`,subject('c1','science'));assert.equal(r.status,201);ids.scienceAssignment=r.body.item.id;
 r=await call('post',`teachers/${ids.t1}/assignments`,advisor('old'));assert.equal(r.status,201);ids.oldAssignment=r.body.item.id;
 r=await call('post',`teachers/${ids.t2}/assignments`,advisor('c1'));assert.equal(r.status,409);
 r=await call('post',`teachers/${ids.t2}/assignments`,subject('c2','math'));assert.equal(r.status,409);
 r=await call('post',`teachers/${ids.t1}/assignments`,{...advisor('c1'),subject_id:ids.math});assert.equal(r.status,400);
 r=await call('post',`teachers/${ids.t1}/assignments`,{class_id:ids.c2,kind:'subject_teacher'});assert.equal(r.status,400);
 r=await call('post',`teachers/${ids.t1}/assignments`,{...advisor('c2'),academic_year_id:ids.y1});assert.equal(r.status,400);
 r=await call('post',`teachers/${ids.t3}/assignments`,advisor('c2'));assert.equal(r.status,400);
 for(const [method,path] of [['post',`teachers/${ids.t1}/assignments`],['put',`teachers/${ids.t1}/assignments/${ids.advisor}`],['delete',`teachers/${ids.t1}/assignments/${ids.advisor}`]]){r=await call(method,path,advisor('c2'),'t1');assert.equal(r.status,403);}
 const roster=`teachers/${ids.t1}/assignments/${ids.advisor}/roster`;
 r=await call('get',roster,undefined,'t1');assert.equal(r.status,200);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].student_id,ids.s1);assert.equal(r.headers['cache-control'],'no-store');
 assert.deepEqual(Object.keys(r.body.items[0]).sort(),['student_id','admission_number','name','enrollment_id','section_id','section_name'].sort());
 r=await call('get',`teachers/${ids.t1}/assignments/${ids.mathAssignment}/roster`,undefined,'t1');assert.equal(r.body.items[0].student_id,ids.s3);
 r=await call('get',`teachers/${ids.t2}/assignments/${ids.scienceAssignment}/roster`,undefined,'t1');assert.equal(r.status,404);
 r=await call('get',`teachers/${ids.t1}/assignments/${ids.scienceAssignment}/roster`,undefined,'t1');assert.equal(r.status,404);
 r=await call('get',roster,undefined,'t2');assert.equal(r.status,404);
 for(const who of ['s1','parent']){r=await call('get',roster,undefined,who);assert.equal(r.status,403);}
 r=await call('get',roster+'?q=ADM-S1',undefined,'t1');assert.equal(r.body.items.length,1);
 r=await call('get',roster+`?section_id=${ids.c}`,undefined,'t1');assert.equal(r.body.items.length,0);
 r=await call('get',roster+'?q=%27%20OR%201%3D1--',undefined,'t1');assert.equal(r.body.items.length,0);
 r=await call('get',`teachers?class_id=${ids.c1}&academic_year_id=${ids.y1}`);assert.equal(r.body.items.length,2);
 r=await call('get',`teachers?class_id=${ids.c2}`,undefined,'t2');assert.equal(r.body.items.length,0);
 r=await call('get','students',undefined,'t1');assert.equal(r.status,403);
 r=await call('get','parents',undefined,'t1');assert.equal(r.status,403);
});
test('deactivation, assignment edits/removal and dependent-record integrity',async()=>{
 const path=`teachers/${ids.t1}`,roster=`${path}/assignments/${ids.advisor}/roster`;
 let r=await call('put',path,profile('t1','inactive'));assert.equal(r.status,200);
 r=await call('get',path,undefined,'t1');assert.equal(r.body.item.employment_status,'inactive');
 r=await call('get',`${path}/assignments`,undefined,'t1');assert.equal(r.body.items.length,3);
 r=await call('get',roster,undefined,'t1');assert.equal(r.status,404);
 r=await call('get',roster);assert.equal(r.status,200);
 r=await call('put',`${path}/assignments/${ids.advisor}`,{class_id:ids.c1,kind:'class_teacher'});assert.equal(r.status,400);
 const {employment_status,...missingStatus}=profile('t1');r=await call('put',path,missingStatus);assert.equal(r.status,400);
 r=await call('put',path,profile('t1'));assert.equal(r.status,200);
 r=await call('get',roster,undefined,'t1');assert.equal(r.status,200);
 r=await call('put',path,{...profile('t1'),joining_date:'2026-06-01'});assert.equal(r.status,400);
 r=await call('put',`academic/academic-years/${ids.y2}`,{name:'y2',start_date:'2020-01-01',end_date:'2020-12-31'});assert.equal(r.status,400);
 r=await call('put',`academic/classes/${ids.old}`,{name:'old',academic_year_id:ids.y1});assert.equal(r.status,409);
 r=await call('delete',`academic/classes/${ids.old}`);assert.equal(r.status,409);
 r=await call('delete',`academic/subjects/${ids.math}`);assert.equal(r.status,409);
 r=await call('delete',path);assert.equal(r.status,409);
 r=await call('put',`${path}/assignments/${ids.mathAssignment}`,{class_id:ids.old,kind:'subject_teacher',subject_id:ids.math});assert.equal(r.status,200);assert.equal(r.body.item.academic_year_id,ids.y2);
 r=await call('get',`${path}/assignments/${ids.mathAssignment}/roster`,undefined,'t1');assert.deepEqual(r.body.items,[]);
 r=await call('delete',`teachers/${ids.t2}/assignments/${ids.advisor}`);assert.equal(r.status,404);
 r=await call('delete',`${path}/assignments/${ids.advisor}`);assert.equal(r.status,204);
 r=await call('get',roster,undefined,'t1');assert.equal(r.status,404);
 for(const key of ['mathAssignment','oldAssignment']){r=await call('delete',`${path}/assignments/${ids[key]}`);assert.equal(r.status,204);}
 r=await call('delete',path);assert.equal(r.status,204);
 r=await call('get','teachers',undefined,'t1');assert.deepEqual(r.body.items,[]);
 const account=await query('SELECT 1 FROM users WHERE id=$1',[accounts.t1]);assert.equal(account.rowCount,1);
});
test('roster pagination and validation preserve assignment boundaries',async()=>{
 for(let index=0;index<25;index++){
  const {rows:[u]}=await query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'student') RETURNING id",[`Additional ${index}`,`additional${index}@example.com`,hash]);
  const {rows:[s]}=await query('INSERT INTO students(user_id,admission_number,admission_date) VALUES($1,$2,$3) RETURNING id',[u.id,`EXTRA-${index}`,'2025-01-01']);
  await query("INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,$5)",[s.id,ids.y1,ids.c1,ids.a,'2025-06-01']);
 }
 const roster=`teachers/${ids.t2}/assignments/${ids.scienceAssignment}/roster`;
 let r=await call('get',roster+'?limit=25',undefined,'t2');assert.equal(r.body.items.length,25);
 r=await call('get',roster+'?limit=25&offset=25',undefined,'t2');assert.equal(r.body.items.length,1);
 for(const path of ['teachers/not-a-uuid','teachers?limit=101',roster+'?limit=0',roster+'?section_id=wrong']){r=await call('get',path);assert.equal(r.status,400);}
 await assert.rejects(query('UPDATE users SET role=$1 WHERE id=$2',['parent',accounts.t2]),e=>e.code==='23503');
 await assert.rejects(query('INSERT INTO teacher_assignments(teacher_id,class_id,academic_year_id,kind,subject_id) VALUES($1,$2,$3,$4,$5)',[ids.t2,ids.c2,ids.y1,'class_teacher',ids.math]),e=>e.code==='23514');
 await assert.rejects(query('INSERT INTO teacher_assignments(teacher_id,class_id,academic_year_id,kind) VALUES($1,$2,$3,$4)',[ids.t2,ids.old,ids.y1,'class_teacher']),e=>e.code==='23503');
});
