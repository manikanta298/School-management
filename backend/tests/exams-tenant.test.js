import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='exams-test-secret'.repeat(5);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const schoolA=(await query("SELECT id FROM schools WHERE slug='existing-school'")).rows[0].id;
// Fixtures default to the initial school; second-school rows pass school_id explicitly.
for(const {table_name} of (await query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='school_id' AND table_name NOT IN ('school_memberships')")).rows)await query(`ALTER TABLE ${table_name} ALTER COLUMN school_id SET DEFAULT '${schoolA}'`);
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const hash=await hashPassword('ExamsPassword!123'),accounts={},tokens={},ids={},defaultScale='00000000-0000-4000-8000-000000000007';
const insert=async(sql,params)=>(await query(sql,params)).rows[0].id;
for(const [key,role] of [['admin','admin'],['mathTeacher','teacher'],['scienceTeacher','teacher'],['advisor','teacher'],['otherTeacher','teacher'],['s1','student'],['s2','student'],['s3','student'],['parent','parent'],['outsider','parent']]){
 accounts[key]=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key.toLowerCase()}@example.com`,hash,role]);await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolA,accounts[key],role]);
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
// Separate file so the isolation checks get their own request-rate window.
test('exams are isolated between schools and cannot reference another school',async()=>{
 const {rows:[sb]}=await query("INSERT INTO schools(name,slug) VALUES('School B','school-b') RETURNING id");const schoolB=sb.id;
 const mk=async(name,role)=>{const id=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[name,`${name}@example.com`,hash,role]);await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolB,id,role]);return id;};
 const adminB=await mk('adminb','admin'),studentBUser=await mk('studentb','student');
 let r=await request(app).post('/api/auth/login').send({email:'adminb@example.com',password:'ExamsPassword!123'});assert.equal(r.status,200);tokens.adminB=r.body.accessToken;
 const yearB=await insert('INSERT INTO academic_years(school_id,name,start_date,end_date) VALUES($1,$2,$3,$4) RETURNING id',[schoolB,'B year','2025-06-01','2026-05-31']);
 const classB=await insert('INSERT INTO classes(school_id,name,academic_year_id) VALUES($1,$2,$3) RETURNING id',[schoolB,'B1',yearB]);
 const sectionB=await insert('INSERT INTO sections(school_id,name,class_id,capacity) VALUES($1,$2,$3,40) RETURNING id',[schoolB,'A',classB]);
 const subjectB=await insert('INSERT INTO subjects(school_id,name,code) VALUES($1,$2,$3) RETURNING id',[schoolB,'maths-b','MB']);
 const studentB=await insert('INSERT INTO students(school_id,user_id,admission_number,admission_date) VALUES($1,$2,$3,$4) RETURNING id',[schoolB,studentBUser,'B-1','2025-01-01']);
 await insert('INSERT INTO enrollments(school_id,student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[schoolB,studentB,yearB,classB,sectionB,'2025-06-01']);
 // School A exam to attack.
 r=await call('post','',exam('Isolation exam'));assert.equal(r.status,201);const examA=r.body.item.id;
 r=await call('post',`/${examA}/papers`,paper('math'));assert.equal(r.status,201);const paperA=r.body.item.id;
 // School B admin sees nothing of School A.
 r=await call('get','',undefined,'adminB');assert.equal(r.status,200);assert.deepEqual(r.body.items,[]);
 r=await call('get','/grading-scales',undefined,'adminB');assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body.items,[]);
 for(const [m,path,body] of [['get',`/${examA}`],['get',`/${examA}/papers`],['get',`/${examA}/candidates`],['get',`/${examA}/audit`],['get',`/${examA}/results`],['get',`/${examA}/papers/${paperA}/marks`],['post',`/${examA}/papers`,paper('math')],['put',`/${examA}/papers/${paperA}`,paper('math')],['delete',`/${examA}/papers/${paperA}`],['post',`/${examA}/candidates`,{student_id:studentB}],['delete',`/${examA}/candidates/${ids.s1}`],['put',`/${examA}/papers/${paperA}/marks`,{expected_version:0,entries:[entry('s1','absent')]}],['post',`/${examA}/publish`,{}],['post',`/${examA}/cancel`,{reason:'cross school'}]]){r=await call(m,path,body,'adminB');assert.equal(r.status,404,`${m} ${path}`);}
 // Cross-school references in create are rejected.
 r=await call('post','',{...exam('Steal'),class_id:ids.c1,term_id:null},'adminB');assert.equal(r.status,404);
 r=await call('post','',{class_id:classB,term_id:null,grading_scale_id:defaultScale,name:'Wrong scale',start_date:'2025-09-10',end_date:'2025-09-11'},'adminB');assert.ok([400,409].includes(r.status),`scale ${r.status}`);
 // School B runs its own cycle, and may reuse scale and exam names.
 r=await call('post','/grading-scales',{name:'Default A–F',bands:[{minimum_percent:0,label:'F'},{minimum_percent:50,label:'P'}]},'adminB');assert.equal(r.status,201);const scaleB=r.body.item.id;
 r=await call('get','/grading-scales',undefined,'adminB');assert.deepEqual(r.body.items.map(i=>i.id),[scaleB]);
 r=await call('post','',{class_id:classB,term_id:null,grading_scale_id:scaleB,name:'Isolation exam',start_date:'2025-09-10',end_date:'2025-09-11'},'adminB');assert.equal(r.status,201);const examB=r.body.item.id;
 r=await call('post',`/${examB}/papers`,{subject_id:subjectB,held_on:'2025-09-10',max_marks:100,pass_marks:40},'adminB');assert.equal(r.status,201);const paperB=r.body.item.id;
 r=await call('post',`/${examB}/papers`,{subject_id:ids.math,held_on:'2025-09-10',max_marks:100,pass_marks:40},'adminB');assert.ok([400,409,404].includes(r.status),`foreign subject ${r.status}`);
 r=await call('put',`/${examB}/papers/${paperB}/marks`,{expected_version:0,entries:[{student_id:studentB,outcome:'scored',score:75,remark:null}]},'adminB');assert.equal(r.status,200);
 r=await call('get','',undefined,'adminB');assert.deepEqual(r.body.items.map(i=>i.id),[examB]);
 r=await call('get',`/${examB}/candidates`,undefined,'adminB');assert.deepEqual(r.body.items.map(i=>i.student_id),[studentB]);
 r=await call('get',`/${examB}`);assert.equal(r.status,404);
 r=await call('get',`/${examB}/audit`,undefined,'adminB');assert.equal(r.body.items.length,1);
 // School A is untouched.
 r=await call('get',`/${examA}`);assert.equal(r.status,200);assert.equal(r.body.item.status,'draft');
 r=await call('get',`/${examA}/papers`);assert.equal(r.body.items.length,1);
 r=await call('get',`/${examA}/audit`);assert.equal(r.body.items.length,0);
 r=await call('get','');assert.ok(r.body.items.every(i=>i.id!==examB));
 // Database-level guards reject cross-school rows even when written directly.
 await assert.rejects(query('INSERT INTO exam_papers(school_id,exam_id,subject_id,held_on,max_marks,pass_marks) VALUES($1,$2,$3,$4,10,4)',[schoolB,examA,subjectB,'2025-09-10']),/violates foreign key constraint "exam_papers_exam_same_school_fk"/);
 await assert.rejects(query('INSERT INTO exam_papers(school_id,exam_id,subject_id,held_on,max_marks,pass_marks) VALUES($1,$2,$3,$4,10,4)',[schoolB,examB,ids.science,'2025-09-10']),/violates foreign key constraint "exam_papers_subject_same_school_fk"/);
 await assert.rejects(query('INSERT INTO exam_marks(school_id,exam_id,paper_id,student_id,outcome,score,updated_by) VALUES($1,$2,$3,$4,$5,5,$6)',[schoolB,examB,paperA,studentB,'scored',adminB]),/Invalid score, future paper or closed exam|violates foreign key/);
});
