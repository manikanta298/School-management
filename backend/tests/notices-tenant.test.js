import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='notices-test-secret'.repeat(5);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const schoolA=(await query("SELECT id FROM schools WHERE slug='existing-school'")).rows[0].id;
// Fixtures default to the initial school; second-school rows pass school_id explicitly.
for(const {table_name} of (await query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='school_id' AND table_name NOT IN ('school_memberships')")).rows)await query(`ALTER TABLE ${table_name} ALTER COLUMN school_id SET DEFAULT '${schoolA}'`);
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const hash=await hashPassword('NoticesPassword!123'),accounts={},tokens={},ids={};const insert=async(sql,params)=>(await query(sql,params)).rows[0].id;
for(const [key,role] of [['admin','admin'],['t1','teacher'],['t2','teacher'],['t3','teacher'],['s1','student'],['s2','student'],['s3','student'],['parent','parent'],['otherParent','parent'],['outsider','parent']]){
 accounts[key]=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key.toLowerCase()}@example.com`,hash,role]);await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolA,accounts[key],role]);const r=await request(app).post('/api/auth/login').send({email:`${key.toLowerCase()}@example.com`,password:'NoticesPassword!123'});assert.equal(r.status,200);tokens[key]=r.body.accessToken;
}
ids.year=await insert("INSERT INTO academic_years(name,start_date,end_date,is_current) VALUES('Current year',CURRENT_DATE-30,CURRENT_DATE+330,true) RETURNING id");
for(const key of ['c1','c2'])ids[key]=await insert('INSERT INTO classes(name,academic_year_id) VALUES($1,$2) RETURNING id',[key,ids.year]);
for(const [key,cl] of [['a','c1'],['b','c1'],['c','c2']])ids[key]=await insert('INSERT INTO sections(name,class_id,capacity) VALUES($1,$2,40) RETURNING id',[key,ids[cl]]);
for(const key of ['math','science'])ids[key]=await insert('INSERT INTO subjects(name,code) VALUES($1,$2) RETURNING id',[key,key.toUpperCase()]);
for(const [key,cl,sub] of [['t1','c1','math'],['t2','c2','science']]){
 ids[key]=await insert('INSERT INTO teachers(user_id,employee_number,joining_date) VALUES($1,$2,CURRENT_DATE-365) RETURNING id',[accounts[key],key.toUpperCase()]);
 ids[key+'assignment']=await insert("INSERT INTO teacher_assignments(teacher_id,class_id,academic_year_id,kind,subject_id) VALUES($1,$2,$3,'subject_teacher',$4) RETURNING id",[ids[key],ids[cl],ids.year,ids[sub]]);
 await query('INSERT INTO timetable_slots(section_id,class_id,academic_year_id,assignment_id,teacher_id,subject_id,weekday,start_minute,end_minute,effective_from,effective_to,created_by,changed_by) VALUES($1,$2,$3,$4,$5,$6,extract(isodow FROM CURRENT_DATE)::int,540,600,CURRENT_DATE-30,CURRENT_DATE+330,$7,$7)',[key==='t1'?ids.a:ids.c,ids[cl],ids.year,ids[key+'assignment'],ids[key],ids[sub],accounts.admin]);
}
for(const [key,sec,cl] of [['s1','a','c1'],['s2','b','c1'],['s3','c','c2']]){
 ids[key]=await insert('INSERT INTO students(user_id,admission_number,admission_date) VALUES($1,$2,CURRENT_DATE-60) RETURNING id',[accounts[key],key.toUpperCase()]);
 ids[key+'enrollment']=await insert('INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,CURRENT_DATE-30) RETURNING id',[ids[key],ids.year,ids[cl],ids[sec]]);
}
for(const key of ['parent','otherParent','outsider'])ids[key]=await insert('INSERT INTO parents(user_id) VALUES($1) RETURNING id',[accounts[key]]);
await query("INSERT INTO student_parents(student_id,parent_id,relationship) VALUES($1,$2,'guardian'),($3,$4,'guardian')",[ids.s1,ids.parent,ids.s3,ids.otherParent]);
for(const [student,sec,cl,status] of [['s1','a','c1','present'],['s3','c','c2','absent']]){
 const rid=await insert('INSERT INTO attendance_registers(section_id,class_id,academic_year_id,attendance_date,created_by) VALUES($1,$2,$3,CURRENT_DATE,$4) RETURNING id',[ids[sec],ids[cl],ids.year,accounts.admin]);
 await query('INSERT INTO attendance_entries(register_id,attendance_date,student_id,enrollment_id,status,updated_by) VALUES($1,CURRENT_DATE,$2,$3,$4,$5)',[rid,ids[student],ids[student+'enrollment'],status,accounts.admin]);
}
for(const [student,cl,sub,currency,amount] of [['s1','c1','math','INR',10000],['s3','c2','science','USD',90000]]){
 const f=await insert('INSERT INTO fee_structures(class_id,academic_year_id,name,amount_minor,currency) VALUES($1,$2,$3,$4,$5) RETURNING id',[ids[cl],ids.year,student+' fee',amount,currency]);
 const inv=await insert('INSERT INTO fee_invoices(student_id,fee_structure_id,enrollment_id,class_id,academic_year_id,title,amount_minor,currency,issued_on,due_on,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE-2,CURRENT_DATE-1,$9) RETURNING id',[ids[student],f,ids[student+'enrollment'],ids[cl],ids.year,student+' fee',amount,currency,accounts.admin]);
 if(student==='s1')await query("INSERT INTO fee_payments(invoice_id,amount_minor,paid_on,method,idempotency_key,recorded_by) VALUES($1,2500,CURRENT_DATE,'cash',gen_random_uuid(),$2)",[inv,accounts.admin]);
 const ex=await insert("INSERT INTO exams(class_id,academic_year_id,grading_scale_id,name,start_date,end_date,created_by,updated_by) VALUES($1,$2,'00000000-0000-4000-8000-000000000007',$3,CURRENT_DATE-10,CURRENT_DATE-9,$4,$4) RETURNING id",[ids[cl],ids.year,student+' results',accounts.admin]);
 await query('INSERT INTO exam_candidates(exam_id,student_id,enrollment_id,section_id,class_id) VALUES($1,$2,$3,$4,$5)',[ex,ids[student],ids[student+'enrollment'],student==='s1'?ids.a:ids.c,ids[cl]]);
 const p=await insert('INSERT INTO exam_papers(exam_id,subject_id,held_on,max_marks,pass_marks) VALUES($1,$2,CURRENT_DATE-10,100,40) RETURNING id',[ex,ids[sub]]);
 await query("INSERT INTO exam_marks(exam_id,paper_id,student_id,outcome,score,updated_by) VALUES($1,$2,$3,'scored',80,$4)",[ex,p,ids[student],accounts.admin]);
 await query("UPDATE exams SET status='published',updated_by=$1 WHERE id=$2",[accounts.admin,ex]);
}
await query("INSERT INTO exams(class_id,academic_year_id,grading_scale_id,name,start_date,end_date,created_by,updated_by) VALUES($1,$2,'00000000-0000-4000-8000-000000000007','Other class private draft',CURRENT_DATE-5,CURRENT_DATE-4,$3,$3)",[ids.c2,ids.year,accounts.admin]);
const now=Date.now(),past=new Date(now-60000).toISOString(),future=new Date(now+86400000).toISOString();
const draft=(title,extra={})=>({title,body:'School announcement text.',audience:'all',class_id:null,section_id:null,priority:'normal',available_from:past,expires_at:null,...extra});
const call=(method,path,body,who='admin')=>{const req=request(app)[method]('/api/'+path).set('Authorization',`Bearer ${tokens[who]}`);return body?req.send(body):req;};
async function published(key,data){let r=await call('post','notices',data);assert.equal(r.status,201);ids[key]=r.body.item.id;r=await call('post',`notices/${ids[key]}/publish`,{expected_version:1});assert.equal(r.status,200);return r.body.item;}
after(async()=>{await db.close();await pool.end();});
// Separate file so the isolation checks get their own request-rate window.
test('notices are isolated between schools and cannot reference another school',async()=>{
 const {rows:[sb]}=await query("INSERT INTO schools(name,slug) VALUES('School B','school-b') RETURNING id");const schoolB=sb.id;
 const mk=async(name,role)=>{const id=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[name,`${name}@example.com`,hash,role]);await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolB,id,role]);return id;};
 const adminB=await mk('adminb','admin'),studentBUser=await mk('studentb','student');
 for(const who of ['adminb','studentb']){const r=await request(app).post('/api/auth/login').send({email:`${who}@example.com`,password:'NoticesPassword!123'});assert.equal(r.status,200);tokens[who]=r.body.accessToken;}
 const yearB=await insert("INSERT INTO academic_years(school_id,name,start_date,end_date,is_current) VALUES($1,'B year',CURRENT_DATE-30,CURRENT_DATE+330,true) RETURNING id",[schoolB]);
 const classB=await insert('INSERT INTO classes(school_id,name,academic_year_id) VALUES($1,$2,$3) RETURNING id',[schoolB,'B1',yearB]);
 const sectionB=await insert('INSERT INTO sections(school_id,name,class_id,capacity) VALUES($1,$2,$3,40) RETURNING id',[schoolB,'A',classB]);
 const studentB=await insert('INSERT INTO students(school_id,user_id,admission_number,admission_date) VALUES($1,$2,$3,CURRENT_DATE-60) RETURNING id',[schoolB,studentBUser,'B-1']);
 await insert('INSERT INTO enrollments(school_id,student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,$5,CURRENT_DATE-30) RETURNING id',[schoolB,studentB,yearB,classB,sectionB]);
 // School A notices to attack: one school-wide, one class-targeted.
 const wide=await published('wideA',draft('School A assembly'));const targeted=await published('targetA',draft('School A class 1 notice',{class_id:ids.c1}));
 // School B sees nothing of School A, even for school-wide notices.
 for(const who of ['adminb','studentb']){let r=await call('get','notices',undefined,who);assert.deepEqual(r.body.items,[],who);}
 let r=await call('get','notices/manage',undefined,'adminb');assert.deepEqual(r.body.items,[]);
 for(const [m,path,body] of [['get',`notices/${wide.id}`],['get',`notices/${wide.id}/audit`],['get',`notices/${wide.id}/readers`],['put',`notices/${wide.id}`,{...draft('Hijack'),expected_version:2}],['post',`notices/${wide.id}/archive`,{expected_version:2,reason:'cross school'}],['post',`notices/${wide.id}/unpublish`,{expected_version:2,reason:'cross school'}],['post',`notices/${wide.id}/read`,{content_revision:1}]]){r=await call(m,path,body,m==='post'&&path.endsWith('/read')?'studentb':'adminb');assert.equal(r.status,404,`${m} ${path}`);}
 r=await call('get',`notices/${wide.id}`,undefined,'studentb');assert.equal(r.status,404);
 // Cross-school class and section references are rejected.
 r=await call('post','notices',draft('Steal class',{class_id:ids.c1}),'adminb');assert.equal(r.status,404);
 r=await call('post','notices',draft('Steal section',{class_id:classB,section_id:ids.a}),'adminb');assert.ok([400,404,409].includes(r.status),`section ${r.status}`);
 // School B publishes its own notices; only School B sees them.
 r=await call('post','notices',draft('School B assembly'),'adminb');assert.equal(r.status,201);const bId=r.body.item.id;
 r=await call('post',`notices/${bId}/publish`,{expected_version:1},'adminb');assert.equal(r.status,200);
 r=await call('get','notices',undefined,'studentb');assert.deepEqual(r.body.items.map(i=>i.id),[bId]);
 r=await call('post',`notices/${bId}/read`,{content_revision:1},'studentb');assert.equal(r.status,204);
 r=await call('get',`notices/${bId}/readers`,undefined,'adminb');assert.equal(r.body.items.length,1);
 r=await call('get','notices');assert.ok(r.body.items.every(i=>i.id!==bId));
 r=await call('get',`notices/${bId}`);assert.equal(r.status,404);
 r=await call('get',`notices/${bId}/audit`,undefined,'adminb');assert.ok(r.body.items.length>=2);
 // School A is untouched by the rejected attempts.
 r=await call('get',`notices/${wide.id}`);assert.equal(r.status,200);assert.equal(r.body.item.status,'published');
 r=await call('get',`notices/${wide.id}/readers`);assert.equal(r.body.items.length,0);
 // Dashboards only count the viewer's own school.
 r=await call('get','dashboard',undefined,'adminb');assert.equal(r.status,200);
 assert.equal(r.body.stats.profiles.students,1);assert.equal(r.body.stats.profiles.parents,0);assert.equal(r.body.stats.profiles.active_teachers,0);
 assert.deepEqual(r.body.stats.active_accounts,{admin:1,student:1});assert.deepEqual(r.body.insights.recent_admissions.map(i=>i.admission_number),['B-1']);assert.deepEqual(r.body.insights.class_strength.map(i=>i.name),['B1']);
 assert.deepEqual(r.body.notices.items.map(i=>i.id),[bId]);
 r=await call('get','dashboard');assert.equal(r.status,200);assert.ok(r.body.stats.profiles.students>=3);assert.ok(r.body.insights.recent_admissions.every(i=>i.admission_number!=='B-1'));assert.ok(r.body.notices.items.every(i=>i.id!==bId));
 // Database-level guards reject cross-school rows even when written directly.
 await assert.rejects(query("INSERT INTO notices(school_id,title,body,audience,class_id,academic_year_id,priority,available_from,created_by,updated_by) VALUES($1,'x','x','all',$2,$3,'normal',now(),$4,$4)",[schoolB,ids.c1,ids.year,adminB]),/violates foreign key constraint "notices_(class|year)_same_school_fk"/);
 await assert.rejects(query("INSERT INTO notice_reads(school_id,notice_id,user_id,content_revision) VALUES($1,$2,$3,1)",[schoolB,wide.id,studentBUser]),/violates foreign key constraint "notice_reads_notice_same_school_fk"|Acknowledge only/);
});
