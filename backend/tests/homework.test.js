import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='homework-test-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const hash=await hashPassword('HomeworkPassword!123'),accounts={},tokens={},ids={},schoolId=(await query("SELECT id FROM schools WHERE slug='existing-school'")).rows[0].id;
const insert=async(sql,params)=>(await query(sql,params)).rows[0].id;
for(const [key,role] of [['admin','admin'],['math','teacher'],['science','teacher'],['classTeacher','teacher'],['s1','student'],['s2','student'],['s3','student'],['parent','parent'],['outsider','parent']]){
 accounts[key]=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key.toLowerCase()}@example.com`,hash,role]);
 await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolId,accounts[key],role]);
 const login=await request(app).post('/api/auth/login').send({email:`${key.toLowerCase()}@example.com`,password:'HomeworkPassword!123'});assert.equal(login.status,200);tokens[key]=login.body.accessToken;
}
const call=(method,path,body,who='admin')=>{const req=request(app)[method]('/api/'+path).set('Authorization',`Bearer ${tokens[who]}`);return body?req.send(body):req;};
const day=offset=>{const d=new Date();d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
ids.year=await insert("INSERT INTO academic_years(name,start_date,end_date,is_current,school_id) VALUES('Current',CURRENT_DATE-60,CURRENT_DATE+300,true,$1) RETURNING id",[schoolId]);
for(const key of ['c1','c2'])ids[key]=await insert('INSERT INTO classes(name,academic_year_id,school_id) VALUES($1,$2,$3) RETURNING id',[key,ids.year,schoolId]);
for(const [key,cl] of [['a','c1'],['b','c1'],['c','c2']])ids[key]=await insert('INSERT INTO sections(name,class_id,capacity) VALUES($1,$2,40) RETURNING id',[key,ids[cl]]);
for(const key of ['mathSubject','scienceSubject'])ids[key]=await insert('INSERT INTO subjects(name,code,school_id) VALUES($1,$2,$3) RETURNING id',[key,key.toUpperCase(),schoolId]);
for(const [key,kind,cl,subject] of [['math','subject_teacher','c1','mathSubject'],['science','subject_teacher','c2','scienceSubject'],['classTeacher','class_teacher','c1',null]]){
 ids[key]=await insert("INSERT INTO teachers(user_id,employee_number,joining_date) VALUES($1,$2,CURRENT_DATE-365) RETURNING id",[accounts[key],key.toUpperCase()]);
 await query('INSERT INTO teacher_assignments(teacher_id,class_id,academic_year_id,kind,subject_id) VALUES($1,$2,$3,$4,$5)',[ids[key],ids[cl],ids.year,kind,subject?ids[subject]:null]);
}
for(const [key,sec,cl] of [['s1','a','c1'],['s2','b','c1'],['s3','c','c2']]){
 ids[key]=await insert('INSERT INTO students(user_id,admission_number,admission_date) VALUES($1,$2,CURRENT_DATE-90) RETURNING id',[accounts[key],key.toUpperCase()]);
 await query('INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,CURRENT_DATE-30)',[ids[key],ids.year,ids[cl],ids[sec]]);
}
ids.parent=await insert('INSERT INTO parents(user_id) VALUES($1) RETURNING id',[accounts.parent]);await insert('INSERT INTO parents(user_id) VALUES($1) RETURNING id',[accounts.outsider]);
await query("INSERT INTO student_parents(student_id,parent_id,relationship,school_id) VALUES($1,$2,'guardian',$3)",[ids.s1,ids.parent,schoolId]);
after(async()=>{await db.close();await pool.end();});
const post=(extra={},who='math')=>call('post','homework',{section_id:ids.a,subject_id:ids.mathSubject,title:'Fractions',details:'Complete exercise 4.',due_on:day(3),...extra},who);
test('only assigned subject teachers or admins can post, with strict validation',async()=>{
 let r=await request(app).get('/api/homework');assert.equal(r.status,401);
 r=await post();assert.equal(r.status,201,JSON.stringify(r.body));ids.hw=r.body.item.id;assert.equal(r.body.item.subject_name,'mathSubject');assert.equal(r.body.item.section_name,'a');assert.equal(r.body.item.assigned_on,day(0));assert.equal(r.body.item.completion_count,0);
 for(const who of ['science','classTeacher']){r=await post({},who);assert.equal(r.status,403);}
 r=await post({subject_id:ids.scienceSubject});assert.equal(r.status,403);
 for(const who of ['s1','parent']){r=await post({},who);assert.equal(r.status,403);}
 r=await post({section_id:'00000000-0000-4000-8000-000000000999'});assert.equal(r.status,404);
 r=await post({due_on:day(-1)});assert.equal(r.status,400);
 for(const bad of [{title:'<b>'},{details:''},{due_on:'2024-02-30'},{extra:1}]){r=await post(bad);assert.equal(r.status,400);}
 r=await post({section_id:ids.c,subject_id:ids.scienceSubject},'admin');assert.equal(r.status,201);ids.adminHw=r.body.item.id;
 r=await post({subject_id:'00000000-0000-4000-8000-000000000999'},'admin');assert.equal(r.status,409);
});
test('visibility follows section, class assignment and family links',async()=>{
 for(const [who,count] of [['math',1],['classTeacher',1],['science',1],['s1',1],['parent',1],['s2',0],['outsider',0],['s3',1],['admin',2]]){const r=await call('get','homework',undefined,who);assert.equal(r.status,200);assert.equal(r.body.items.length,count,who);}
 for(const who of ['s2','science','outsider']){const r=await call('get',`homework/${ids.hw}`,undefined,who);assert.equal(r.status,404,who);}
 let r=await call('get',`homework?subject_id=${ids.mathSubject}`);assert.equal(r.body.items.length,1);
 r=await call('get',`homework?due_from=${day(10)}`);assert.equal(r.body.items.length,0);
 r=await call('get',`homework?student_id=${ids.s1}`);assert.equal(r.body.items.length,1);
 for(const bad of ['limit=0','extra=1','include_archived=maybe']){r=await call('get',`homework?${bad}`);assert.equal(r.status,400);}
});
test('students mark their own completion and families see only their children',async()=>{
 let r=await call('post',`homework/${ids.hw}/complete`,undefined,'s1');assert.equal(r.status,200);assert.deepEqual(r.body.item.completed_student_ids,[ids.s1]);
 r=await call('post',`homework/${ids.hw}/complete`,undefined,'s1');assert.equal(r.status,200);assert.equal((await query('SELECT * FROM homework_completions')).rows.length,1);
 r=await call('post',`homework/${ids.hw}/complete`,undefined,'s2');assert.equal(r.status,404);
 for(const who of ['parent','math','admin']){r=await call('post',`homework/${ids.hw}/complete`,undefined,who);assert.equal(r.status,403);}
 r=await call('get',`homework/${ids.hw}`,undefined,'parent');assert.deepEqual(r.body.item.completed_student_ids,[ids.s1]);
 r=await call('get',`homework/${ids.hw}`,undefined,'math');assert.equal(r.body.item.completion_count,1);assert.equal(r.body.item.completed_student_ids,undefined);
 r=await call('delete',`homework/${ids.hw}/complete`,undefined,'s1');assert.deepEqual(r.body.item.completed_student_ids,[]);
});
test('edits and archiving are limited to the posting teacher or an admin',async()=>{
 const body={title:'Fractions v2',details:'Complete exercise 5.',due_on:day(4)};
 let r=await call('put',`homework/${ids.hw}`,body,'science');assert.equal(r.status,404);
 r=await call('put',`homework/${ids.hw}`,body,'classTeacher');assert.equal(r.status,403);
 r=await call('put',`homework/${ids.hw}`,body,'math');assert.equal(r.status,200);assert.equal(r.body.item.title,'Fractions v2');
 r=await call('put',`homework/${ids.hw}`,{...body,due_on:day(-1)});assert.equal(r.status,400);
 r=await call('put',`homework/${ids.hw}`,body,'s1');assert.equal(r.status,403);
 r=await call('post',`homework/${ids.hw}/archive`,undefined,'science');assert.equal(r.status,404);
 r=await call('post',`homework/${ids.hw}/archive`,undefined,'math');assert.equal(r.status,204);
 r=await call('get','homework',undefined,'s1');assert.equal(r.body.items.length,0);
 r=await call('get','homework?include_archived=true',undefined,'s1');assert.equal(r.body.items.length,0);
 r=await call('get','homework',undefined,'math');assert.equal(r.body.items.length,0);
 r=await call('get','homework?include_archived=true',undefined,'math');assert.equal(r.body.items.length,1);assert.ok(r.body.items[0].archived_at);
 r=await call('put',`homework/${ids.hw}`,body,'math');assert.equal(r.status,409);
 r=await call('post',`homework/${ids.hw}/complete`,undefined,'s1');assert.equal(r.status,404);
 r=await call('get',`homework/${ids.hw}`,undefined,'s1');assert.equal(r.status,404);
});
test('transfers change visibility immediately and history is protected',async()=>{
 await query("UPDATE enrollments SET status='withdrawn' WHERE student_id=$1",[ids.s3]);
 let r=await call('get','homework',undefined,'s3');assert.equal(r.body.items.length,0);
 await assert.rejects(query('DELETE FROM sections WHERE id=$1',[ids.c]),e=>e.code==='23503');
});
