import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='exams-test-secret'.repeat(5);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const hash=await hashPassword('ExamsPassword!123'),accounts={},tokens={},ids={},defaultScale='00000000-0000-4000-8000-000000000007';
const insert=async(sql,params)=>(await query(sql,params)).rows[0].id;
for(const [key,role] of [['admin','admin'],['mathTeacher','teacher'],['scienceTeacher','teacher'],['advisor','teacher'],['otherTeacher','teacher'],['s1','student'],['s2','student'],['s3','student'],['parent','parent'],['outsider','parent']]){
 accounts[key]=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key.toLowerCase()}@example.com`,hash,role]);
 const r=await request(app).post('/api/auth/login').send({email:`${key.toLowerCase()}@example.com`,password:'ExamsPassword!123'});assert.equal(r.status,200);tokens[key]=r.body.accessToken;
}
ids.year=await insert("INSERT INTO academic_years(name,start_date,end_date) VALUES('Exam year','2025-06-01','2026-05-31') RETURNING id");
ids.term=await insert("INSERT INTO terms(name,academic_year_id,start_date,end_date) VALUES('Term 1',$1,'2025-09-01','2025-09-30') RETURNING id",[ids.year]);
for(const key of ['c1','c2'])ids[key]=await insert('INSERT INTO classes(name,academic_year_id) VALUES($1,$2) RETURNING id',[key,ids.year]);
for(const [key,cl] of [['a','c1'],['b','c2']])ids[key]=await insert('INSERT INTO sections(name,class_id,capacity) VALUES($1,$2,40) RETURNING id',[key,ids[cl]]);
for(const key of ['math','science'])ids[key]=await insert('INSERT INTO subjects(name,code) VALUES($1,$2) RETURNING id',[key,key.toUpperCase()]);
for(const [key,cl,subject] of [['mathTeacher','c1','math'],['scienceTeacher','c1','science'],['advisor','c1',null],['otherTeacher','c2','math']]){
 ids[key]=await insert('INSERT INTO teachers(user_id,employee_number,joining_date) VALUES($1,$2,$3) RETURNING id',[accounts[key],key.toUpperCase(),'2020-01-01']);
 ids[key+'assignment']=await insert('INSERT INTO teacher_assignments(teacher_id,class_id,academic_year_id,kind,subject_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[ids[key],ids[cl],ids.year,subject?'subject_teacher':'class_teacher',subject?ids[subject]:null]);
}
for(const key of ['s1','s2','s3']){ids[key]=await insert('INSERT INTO students(user_id,admission_number,admission_date) VALUES($1,$2,$3) RETURNING id',[accounts[key],key.toUpperCase(),'2025-01-01']);ids[key+'enrollment']=await insert('INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,$5) RETURNING id',[ids[key],ids.year,key==='s3'?ids.c2:ids.c1,key==='s3'?ids.b:ids.a,'2025-06-01']);}
ids.parent=await insert('INSERT INTO parents(user_id) VALUES($1) RETURNING id',[accounts.parent]);await query("INSERT INTO student_parents(student_id,parent_id,relationship) VALUES($1,$2,'guardian')",[ids.s1,ids.parent]);
const call=(method,path,body,who='admin')=>{const req=request(app)[method]('/api/exams'+path).set('Authorization',`Bearer ${tokens[who]}`);return body?req.send(body):req;};
const exam=(name='Term assessment')=>({class_id:ids.c1,term_id:ids.term,grading_scale_id:defaultScale,name,start_date:'2025-09-10',end_date:'2025-09-11'});
const paper=(subject='math')=>({subject_id:ids[subject],held_on:'2025-09-10',max_marks:subject==='math'?100:50,pass_marks:subject==='math'?40:20});
const entry=(key,outcome,score=null,remark=null)=>({student_id:ids[key],outcome,score,remark});
const marks=(entries,expected_version=0,correction_reason=null)=>({entries,expected_version,correction_reason});
after(async()=>{await db.close();await pool.end();});
test('exam setup, grading rules, candidates and teacher paper scopes',async()=>{
 let r=await request(app).get('/api/exams');assert.equal(r.status,401);
 r=await call('post','/grading-scales',{name:'Bad',bands:[{minimum_percent:50,label:'P'},{minimum_percent:60,label:'F'}]});assert.equal(r.status,400);
 r=await call('post','/grading-scales',{name:'Pass scale',bands:[{minimum_percent:50,label:'P'},{minimum_percent:0,label:'F'}]});assert.equal(r.status,201);
 r=await call('post','',{...exam(),end_date:'2025-10-01'});assert.equal(r.status,400);
 r=await call('post','',exam());assert.equal(r.status,201);ids.exam=r.body.item.id;assert.equal(r.body.item.can_class_report,true);
 r=await call('get',`/${ids.exam}/candidates`);assert.equal(r.body.items.length,2);
 r=await call('get','',undefined,'mathTeacher');assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].can_class_report,false);
 r=await call('get','',undefined,'otherTeacher');assert.equal(r.body.items.length,0);
 r=await call('get','',undefined,'parent');assert.deepEqual(r.body.items,[]);
 r=await call('get',`/${ids.exam}`,undefined,'parent');assert.equal(r.status,404);
 r=await call('post','',exam('Unauthorized'),'mathTeacher');assert.equal(r.status,403);
 for(const subject of ['math','science']){r=await call('post',`/${ids.exam}/papers`,paper(subject));assert.equal(r.status,201);ids[subject+'paper']=r.body.item.id;}
 r=await call('post',`/${ids.exam}/papers`,paper());assert.equal(r.status,409);
 r=await call('post',`/${ids.exam}/papers`,{...paper(),pass_marks:101});assert.equal(r.status,400);
 r=await call('get',`/${ids.exam}/papers`,undefined,'mathTeacher');assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].can_mark,true);
 r=await call('get',`/${ids.exam}/papers`,undefined,'advisor');assert.equal(r.body.items.length,2);assert.equal(r.body.items[0].can_mark,false);
 r=await call('post',`/${ids.exam}/candidates`,{student_id:ids.s3});assert.equal(r.status,400);
 r=await call('post',`/${ids.exam}/candidates`,{student_id:ids.s1});assert.equal(r.status,409);
 r=await call('delete',`/${ids.exam}/candidates/${ids.s2}`);assert.equal(r.status,204);
 r=await call('post',`/${ids.exam}/candidates`,{student_id:ids.s2});assert.equal(r.status,201);
 r=await call('post',`/${ids.exam}/publish`,{});assert.equal(r.status,400);
});
test('mark entry is atomic, subject scoped, versioned and audited',async()=>{
 const math=`/${ids.exam}/papers/${ids.mathpaper}/marks`,science=`/${ids.exam}/papers/${ids.sciencepaper}/marks`;
 let r=await call('get',science,undefined,'mathTeacher');assert.equal(r.status,404);
 r=await call('put',math,marks([entry('s1','scored',80)]),'advisor');assert.equal(r.status,404);
 r=await call('put',math,marks([entry('s1','scored',80),entry('s2','absent')]),'mathTeacher');assert.equal(r.status,200);assert.deepEqual(r.body,{version:1,changed:2});
 r=await call('put',math,marks([entry('s1','scored',80)],1),'mathTeacher');assert.deepEqual(r.body,{version:1,changed:0});
 r=await call('put',math,marks([entry('s1','scored',101)],1,'Fix score'),'mathTeacher');assert.equal(r.status,400);
 r=await call('put',math,marks([entry('s1','scored',90)],0,'Fix score'),'mathTeacher');assert.equal(r.status,409);
 r=await call('put',math,marks([entry('s1','scored',90)],1),'mathTeacher');assert.equal(r.status,400);
 r=await call('put',math,marks([entry('s1','scored',90),entry('s3','scored',50)],1,'Fix score'),'mathTeacher');assert.equal(r.status,409);
 r=await call('get',math,undefined,'mathTeacher');assert.equal(r.body.paper.version,1);assert.equal(r.body.items.find(x=>x.student_id===ids.s1).score,80);
 r=await call('put',math,marks([entry('s1','scored',90)],1,'Verified answer script'),'mathTeacher');assert.equal(r.status,200);assert.equal(r.body.version,2);
 r=await call('put',science,marks([entry('s2','exempt')]),'scienceTeacher');assert.equal(r.status,400);
 r=await call('put',science,marks([entry('s1','scored',40.5)]),'scienceTeacher');assert.equal(r.status,400);
 r=await call('put',science,marks([entry('s1','scored',40),entry('s2','exempt',null,'Approved exemption')]),'scienceTeacher');assert.equal(r.status,200);
 r=await call('put',`/${ids.exam}/papers/${ids.mathpaper}`,{...paper(),max_marks:200});assert.equal(r.status,400);
 r=await call('delete',`/${ids.exam}/candidates/${ids.s2}`);assert.equal(r.status,409);
 r=await call('get',`/${ids.exam}/audit`);assert.equal(r.body.items.length,5);
 r=await call('get',`/${ids.exam}/audit`,undefined,'mathTeacher');assert.equal(r.status,403);
 await assert.rejects(query("UPDATE exam_mark_audit SET reason='rewrite'"),e=>e.code==='23514');
 await assert.rejects(query('DELETE FROM exam_events'),e=>e.code==='23514');
});
test('publication gates family results, grades weighted totals and supports correction cycles',async()=>{
 let r=await call('get',`/${ids.exam}/results`,undefined,'mathTeacher');assert.equal(r.status,403);
 r=await call('get',`/${ids.exam}/results`,undefined,'advisor');assert.equal(r.status,200);const first=r.body.items.find(x=>x.student_id===ids.s1);assert.equal(first.total_score,130);assert.equal(first.total_max,150);assert.equal(first.grade,'B');assert.equal(first.percentage,86.67);assert.equal(first.result,'pass');
 r=await call('post',`/${ids.exam}/publish`,{});assert.equal(r.status,200);
 r=await call('get','',undefined,'parent');assert.equal(r.body.items.length,1);
 r=await call('get',`/${ids.exam}/my-results`,undefined,'parent');assert.equal(r.status,200);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].student_id,ids.s1);
 r=await call('get',`/${ids.exam}/my-results`,undefined,'s2');assert.equal(r.body.items[0].result,'fail');assert.equal(r.body.items[0].total_max,100);assert.equal(r.body.items[0].total_score,0);
 for(const who of ['parent','s1']){r=await call('get',`/${ids.exam}/students/${ids.s2}`,undefined,who);assert.equal(r.status,404);}
 r=await call('get',`/${ids.exam}/my-results`,undefined,'outsider');assert.equal(r.status,404);
 r=await call('get',`?student_id=${ids.s2}`,undefined,'parent');assert.deepEqual(r.body.items,[]);
 r=await call('get',`/${ids.exam}/papers`,undefined,'parent');assert.equal(r.body.items.length,2);
 r=await call('get',`/${ids.exam}/papers/${ids.mathpaper}/marks`,undefined,'parent');assert.equal(r.status,403);
 r=await call('put',`/${ids.exam}/papers/${ids.mathpaper}/marks`,marks([entry('s1','scored',99)],2,'Correction'),'mathTeacher');assert.equal(r.status,409);
 await assert.rejects(query('UPDATE exam_grade_bands SET label=$1 WHERE scale_id=$2 AND minimum_percent=0',['X',defaultScale]),e=>e.code==='23514');
 await assert.rejects(query("UPDATE terms SET end_date='2025-09-09' WHERE id=$1",[ids.term]),e=>e.code==='23514');
 r=await call('post',`/${ids.exam}/reopen`,{reason:'x'});assert.equal(r.status,400);
 r=await call('post',`/${ids.exam}/reopen`,{reason:'Correct verified script'});assert.equal(r.status,200);
 r=await call('get',`/${ids.exam}/my-results`,undefined,'parent');assert.equal(r.status,404);
 r=await call('put',`/${ids.exam}/papers/${ids.sciencepaper}/marks`,marks([entry('s1','scored',45)],1,'Verified final score'),'scienceTeacher');assert.equal(r.status,200);
 r=await call('post',`/${ids.exam}/publish`,{});assert.equal(r.status,200);
 r=await call('get',`/${ids.exam}/my-results`,undefined,'s1');assert.equal(r.body.items[0].grade,'A');assert.equal(r.body.items[0].percentage,90);
 await query('DELETE FROM student_parents WHERE student_id=$1 AND parent_id=$2',[ids.s1,ids.parent]);
 r=await call('get',`/${ids.exam}/my-results`,undefined,'parent');assert.equal(r.status,404);
});
test('candidate snapshots, terminal cancellation, history constraints and revoked assignments',async()=>{
 await query('UPDATE enrollments SET class_id=$1,section_id=$2 WHERE id=$3',[ids.c2,ids.b,ids.s1enrollment]);
 let r=await call('get',`/${ids.exam}/my-results`,undefined,'s1');assert.equal(r.body.items[0].grade,'A');
 await assert.rejects(query('DELETE FROM enrollments WHERE id=$1',[ids.s1enrollment]),e=>e.code==='23503');
 await assert.rejects(query("UPDATE enrollments SET enrolled_on='2025-09-11' WHERE id=$1",[ids.s1enrollment]),e=>e.code==='23514');
 r=await call('post','',exam('Incorrect setup'));assert.equal(r.status,201);ids.cancelled=r.body.item.id;
 r=await call('post',`/${ids.cancelled}/cancel`,{reason:'Incorrect setup dates'});assert.equal(r.status,200);
 r=await call('post',`/${ids.cancelled}/reopen`,{reason:'Try to restore cancelled'});assert.equal(r.status,409);
 r=await call('post','',exam('Incorrect setup'));assert.equal(r.status,201);
 await query("UPDATE teachers SET employment_status='inactive' WHERE id=$1",[ids.mathTeacher]);
 r=await call('get',`/${ids.exam}`,undefined,'mathTeacher');assert.equal(r.status,404);
 await query('DELETE FROM teacher_assignments WHERE id=$1',[ids.advisorassignment]);
 r=await call('get',`/${ids.exam}/results`,undefined,'advisor');assert.equal(r.status,404);
});
test('marks paging, candidate registration and bounded Unicode batches',async()=>{
 for(let index=0;index<26;index++){
  const u=await insert("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'student') RETURNING id",[`Extra ${index}`,`extra${index}@example.com`,hash]);
  const s=await insert('INSERT INTO students(user_id,admission_number,admission_date) VALUES($1,$2,$3) RETURNING id',[u,`EXTRA-${index}`,'2025-01-01']);
  await query('INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,$5)',[s,ids.year,ids.c1,ids.a,'2025-09-01']);
 }
 let r=await call('post','',exam('Paging exam'));assert.equal(r.status,201);const eid=r.body.item.id;
 r=await call('post',`/${eid}/papers`,paper());assert.equal(r.status,201);const pid=r.body.item.id;
 r=await call('get',`/${eid}/papers/${pid}/marks`);assert.equal(r.body.items.length,25);
 r=await call('get',`/${eid}/papers/${pid}/marks?offset=25`);assert.equal(r.body.items.length,2);
 const {rows:candidates}=await query('SELECT student_id FROM exam_candidates WHERE exam_id=$1',[eid]);
 r=await call('put',`/${eid}/papers/${pid}/marks`,marks(candidates.map(c=>({student_id:c.student_id,outcome:'absent',score:null,remark:'漢'.repeat(200)}))));assert.equal(r.status,200);assert.equal(r.body.changed,27);
 r=await call('post',`/${eid}/publish`,{});assert.equal(r.status,200);
});
test('grade calculations distinguish missing, absent, exempt and exact threshold scores',async()=>{
 const {calculate}=await import('../src/services/exams.js');const bands=[{minimum_percent:90,label:'A'},{minimum_percent:0,label:'F'}];
 const p={paper_id:'p',max_marks:100,pass_marks:40};assert.equal(calculate([{...p,outcome:null}],bands).result,'incomplete');assert.equal(calculate([{...p,outcome:'exempt',score:null}],bands).result,'exempt');assert.equal(calculate([{...p,outcome:'absent',score:null}],bands).result,'fail');assert.equal(calculate([{...p,outcome:'scored',score:89}],bands).grade,'F');assert.equal(calculate([{...p,outcome:'scored',score:90}],bands).grade,'A');
});
test('setup edits invalidate old mark-entry versions and future exams stay unpublished',async()=>{
 let r=await call('post','',exam('Setup version exam'));assert.equal(r.status,201);const eid=r.body.item.id;
 r=await call('post',`/${eid}/papers`,paper());assert.equal(r.status,201);const pid=r.body.item.id;
 r=await call('put',`/${eid}/papers/${pid}`,{...paper(),max_marks:90});assert.equal(r.status,200);assert.equal(r.body.item.version,1);
 const {rows:[candidate]}=await query('SELECT student_id FROM exam_candidates WHERE exam_id=$1 LIMIT 1',[eid]);
 r=await call('put',`/${eid}/papers/${pid}/marks`,marks([{student_id:candidate.student_id,outcome:'scored',score:50,remark:null}],0));assert.equal(r.status,409);
 r=await call('put',`/${eid}/papers/${pid}/marks`,marks([{student_id:candidate.student_id,outcome:'scored',score:50,remark:null}],1));assert.equal(r.status,200);
 r=await call('get','?limit=101');assert.equal(r.status,400);
 r=await call('get','/not-a-uuid');assert.equal(r.status,400);
 const y=await insert("INSERT INTO academic_years(name,start_date,end_date) VALUES('Future year','2099-01-01','2099-12-31') RETURNING id");
 const cl=await insert("INSERT INTO classes(name,academic_year_id) VALUES('Future class',$1) RETURNING id",[y]);
 r=await call('post','',{class_id:cl,grading_scale_id:defaultScale,name:'Future exam',start_date:'2099-06-01',end_date:'2099-06-02'});assert.equal(r.status,201);const future=r.body.item.id;
 r=await call('post',`/${future}/papers`,{...paper(),held_on:'2099-06-01'});assert.equal(r.status,201);const fp=r.body.item.id;
 r=await call('put',`/${future}/papers/${fp}/marks`,marks([{student_id:ids.s2,outcome:'scored',score:10,remark:null}]));assert.equal(r.status,400);
 r=await call('post',`/${future}/publish`,{});assert.equal(r.status,400);
});
