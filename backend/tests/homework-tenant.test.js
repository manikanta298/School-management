import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='homework-test-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const schoolA=(await query("SELECT id FROM schools WHERE slug='existing-school'")).rows[0].id;
// Fixtures default to the initial school; second-school rows pass school_id explicitly.
for(const {table_name} of (await query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='school_id' AND table_name NOT IN ('school_memberships')")).rows)await query(`ALTER TABLE ${table_name} ALTER COLUMN school_id SET DEFAULT '${schoolA}'`);
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const hash=await hashPassword('HomeworkPassword!123'),accounts={},tokens={},ids={};
const insert=async(sql,params)=>(await query(sql,params)).rows[0].id;
for(const [key,role] of [['admin','admin'],['math','teacher'],['science','teacher'],['classTeacher','teacher'],['s1','student'],['s2','student'],['s3','student'],['parent','parent'],['outsider','parent']]){
 accounts[key]=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key.toLowerCase()}@example.com`,hash,role]);await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolA,accounts[key],role]);
 const login=await request(app).post('/api/auth/login').send({email:`${key.toLowerCase()}@example.com`,password:'HomeworkPassword!123'});assert.equal(login.status,200);tokens[key]=login.body.accessToken;
}
const call=(method,path,body,who='admin')=>{const req=request(app)[method]('/api/'+path).set('Authorization',`Bearer ${tokens[who]}`);return body?req.send(body):req;};
const day=offset=>{const d=new Date();d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
ids.year=await insert("INSERT INTO academic_years(name,start_date,end_date,is_current) VALUES('Current',CURRENT_DATE-60,CURRENT_DATE+300,true) RETURNING id");
for(const key of ['c1','c2'])ids[key]=await insert('INSERT INTO classes(name,academic_year_id) VALUES($1,$2) RETURNING id',[key,ids.year]);
for(const [key,cl] of [['a','c1'],['b','c1'],['c','c2']])ids[key]=await insert('INSERT INTO sections(name,class_id,capacity) VALUES($1,$2,40) RETURNING id',[key,ids[cl]]);
for(const key of ['mathSubject','scienceSubject'])ids[key]=await insert('INSERT INTO subjects(name,code) VALUES($1,$2) RETURNING id',[key,key.toUpperCase()]);
for(const [key,kind,cl,subject] of [['math','subject_teacher','c1','mathSubject'],['science','subject_teacher','c2','scienceSubject'],['classTeacher','class_teacher','c1',null]]){
 ids[key]=await insert("INSERT INTO teachers(user_id,employee_number,joining_date) VALUES($1,$2,CURRENT_DATE-365) RETURNING id",[accounts[key],key.toUpperCase()]);
 await query('INSERT INTO teacher_assignments(teacher_id,class_id,academic_year_id,kind,subject_id) VALUES($1,$2,$3,$4,$5)',[ids[key],ids[cl],ids.year,kind,subject?ids[subject]:null]);
}
for(const [key,sec,cl] of [['s1','a','c1'],['s2','b','c1'],['s3','c','c2']]){
 ids[key]=await insert('INSERT INTO students(user_id,admission_number,admission_date) VALUES($1,$2,CURRENT_DATE-90) RETURNING id',[accounts[key],key.toUpperCase()]);
 await query('INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,CURRENT_DATE-30)',[ids[key],ids.year,ids[cl],ids[sec]]);
}
ids.parent=await insert('INSERT INTO parents(user_id) VALUES($1) RETURNING id',[accounts.parent]);await insert('INSERT INTO parents(user_id) VALUES($1) RETURNING id',[accounts.outsider]);
await query("INSERT INTO student_parents(student_id,parent_id,relationship) VALUES($1,$2,'guardian')",[ids.s1,ids.parent]);
after(async()=>{await db.close();await pool.end();});
const post=(extra={},who='math')=>call('post','homework',{section_id:ids.a,subject_id:ids.mathSubject,title:'Fractions',details:'Complete exercise 4.',due_on:day(3),...extra},who);
// Separate file so the isolation checks get their own request-rate window.
test('homework is isolated between schools and cannot reference another school',async()=>{
 const {rows:[sb]}=await query("INSERT INTO schools(name,slug) VALUES('School B','school-b') RETURNING id");const schoolB=sb.id;
 const mk=async(name,role)=>{const id=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[name,`${name}@example.com`,hash,role]);await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolB,id,role]);return id;};
 const adminB=await mk('adminb','admin'),studentBUser=await mk('studentb','student');
 for(const who of ['adminb','studentb']){const r=await request(app).post('/api/auth/login').send({email:`${who}@example.com`,password:'HomeworkPassword!123'});assert.equal(r.status,200);tokens[who]=r.body.accessToken;}
 const yearB=await insert("INSERT INTO academic_years(school_id,name,start_date,end_date,is_current) VALUES($1,'B year',CURRENT_DATE-30,CURRENT_DATE+330,true) RETURNING id",[schoolB]);
 const classB=await insert('INSERT INTO classes(school_id,name,academic_year_id) VALUES($1,$2,$3) RETURNING id',[schoolB,'B1',yearB]);
 const sectionB=await insert('INSERT INTO sections(school_id,name,class_id,capacity) VALUES($1,$2,$3,40) RETURNING id',[schoolB,'A',classB]);
 const subjectB=await insert('INSERT INTO subjects(school_id,name,code) VALUES($1,$2,$3) RETURNING id',[schoolB,'maths-b','MB']);
 const studentB=await insert('INSERT INTO students(school_id,user_id,admission_number,admission_date) VALUES($1,$2,$3,CURRENT_DATE-60) RETURNING id',[schoolB,studentBUser,'B-1']);
 await insert('INSERT INTO enrollments(school_id,student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,$5,CURRENT_DATE-30) RETURNING id',[schoolB,studentB,yearB,classB,sectionB]);
 // School A homework to attack.
 let r=await post({},'admin');assert.equal(r.status,201,JSON.stringify(r.body));const hwA=r.body.item.id;
 // School B sees nothing of School A.
 for(const who of ['adminb','studentb']){r=await call('get','homework',undefined,who);assert.deepEqual(r.body.items,[],who);}
 for(const [m,path,body,who] of [['get',`homework/${hwA}`],['put',`homework/${hwA}`,{title:'Hijack',details:'x',due_on:day(5)}],['post',`homework/${hwA}/archive`],['post',`homework/${hwA}/complete`,undefined,'studentb'],['delete',`homework/${hwA}/complete`,undefined,'studentb']]){r=await call(m,path,body,who||'adminb');assert.equal(r.status,404,`${m} ${path}`);}
 // Cross-school references in create are rejected.
 r=await call('post','homework',{section_id:ids.a,subject_id:subjectB,title:'Steal',details:'x',due_on:day(3)},'adminb');assert.equal(r.status,404);
 r=await call('post','homework',{section_id:sectionB,subject_id:ids.mathSubject,title:'Foreign subject',details:'x',due_on:day(3)},'adminb');assert.equal(r.status,409);
 // School B runs its own homework cycle.
 r=await call('post','homework',{section_id:sectionB,subject_id:subjectB,title:'B fractions',details:'x',due_on:day(3)},'adminb');assert.equal(r.status,201);const hwB=r.body.item.id;
 r=await call('get','homework',undefined,'studentb');assert.deepEqual(r.body.items.map(i=>i.id),[hwB]);
 r=await call('post',`homework/${hwB}/complete`,undefined,'studentb');assert.equal(r.status,200);assert.deepEqual(r.body.item.completed_student_ids,[studentB]);
 r=await call('get','homework',undefined,'adminb');assert.deepEqual(r.body.items.map(i=>i.id),[hwB]);assert.equal(r.body.items[0].completion_count,1);
 r=await call('get',`homework/${hwB}`);assert.equal(r.status,404);
 r=await call('get','homework');assert.ok(r.body.items.every(i=>i.id!==hwB));
 // School A is untouched.
 r=await call('get',`homework/${hwA}`);assert.equal(r.status,200);assert.equal(r.body.item.title,'Fractions');assert.equal(r.body.item.archived_at,null);assert.equal(r.body.item.completion_count,0);
 // Database-level guards reject cross-school rows even when written directly.
 await assert.rejects(query("INSERT INTO homework(school_id,section_id,class_id,academic_year_id,subject_id,created_by,title,details,assigned_on,due_on) VALUES($1,$2,$3,$4,$5,$6,'x','x',CURRENT_DATE,CURRENT_DATE)",[schoolB,ids.a,ids.c1,ids.year,subjectB,adminB]),/violates foreign key constraint "homework_(section|class|year)_same_school_fk"/);
 await assert.rejects(query("INSERT INTO homework_completions(school_id,homework_id,student_id) VALUES($1,$2,$3)",[schoolB,hwA,studentB]),/violates foreign key constraint "homework_completions_homework_same_school_fk"/);
});
