import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='notices-test-secret'.repeat(5);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const hash=await hashPassword('NoticesPassword!123'),accounts={},tokens={},ids={};const insert=async(sql,params)=>(await query(sql,params)).rows[0].id;
for(const [key,role] of [['admin','admin'],['t1','teacher'],['t2','teacher'],['t3','teacher'],['s1','student'],['s2','student'],['s3','student'],['parent','parent'],['otherParent','parent'],['outsider','parent']]){
 accounts[key]=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key.toLowerCase()}@example.com`,hash,role]);const r=await request(app).post('/api/auth/login').send({email:`${key.toLowerCase()}@example.com`,password:'NoticesPassword!123'});assert.equal(r.status,200);tokens[key]=r.body.accessToken;
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
test('targeted notice visibility, scheduling and strict content validation',async()=>{
 let r=await request(app).get('/api/notices');assert.equal(r.status,401);
 await published('global',draft('Assembly'));
 await published('parents',draft('Parent meeting',{audience:'parent',class_id:ids.c1,section_id:ids.a}));
 await published('students',draft('Student instructions',{audience:'student',class_id:ids.c1,priority:'important'}));
 await published('sectionB',draft('Section B activity',{class_id:ids.c1,section_id:ids.b,priority:'urgent'}));
 await published('teachers',draft('Teacher briefing',{audience:'teacher'}));
 await published('admins',draft('Admin internal',{audience:'admin'}));
 await published('future',draft('Tomorrow',{available_from:future,priority:'urgent'}));
 await published('private',draft('PRIVATE OTHER CLASS',{class_id:ids.c2}));
 for(const [who,key,expected] of [['parent','parents',200],['otherParent','parents',404],['s1','parents',404],['s1','students',200],['s2','students',200],['s3','students',404],['s2','sectionB',200],['s1','sectionB',404],['t1','sectionB',200],['t2','sectionB',404],['t3','teachers',200],['s1','admins',404],['s1','future',404]]){r=await call('get',`notices/${ids[key]}`,undefined,who);assert.equal(r.status,expected);}
 r=await call('get','notices',undefined,'s1');assert.deepEqual(r.body.items.map(n=>n.title),['Student instructions','Assembly']);assert.equal(r.body.items[0].reader_count,undefined);assert.equal(r.body.items[0].updated_by,undefined);
 r=await call('get','notices/manage',undefined,'parent');assert.equal(r.status,403);
 r=await call('post','notices',draft('Not allowed'),'t1');assert.equal(r.status,403);
 r=await call('post','notices',draft('<script>'));assert.equal(r.status,400);
 r=await call('post','notices',draft('Mismatch',{class_id:ids.c1,section_id:ids.c}));assert.equal(r.status,409);
 r=await call('post','notices',draft('Missing class',{section_id:ids.a}));assert.equal(r.status,400);
 r=await call('post','notices',draft('Bad timestamp',{available_from:'2026-02-30T00:00:00Z'}));assert.equal(r.status,400);
 r=await call('post','notices',draft('Expired',{available_from:new Date(now-172800000).toISOString(),expires_at:new Date(now-86400000).toISOString()}));assert.equal(r.status,201);ids.expired=r.body.item.id;
 r=await call('post',`notices/${ids.expired}/publish`,{expected_version:1});assert.equal(r.status,400);
});
test('read acknowledgments are explicit, revision-specific and idempotent',async()=>{
 let r=await call('get','dashboard',undefined,'s1');assert.equal(r.status,200);assert.equal(r.body.notices.unread_count,2);
 r=await call('get',`notices/${ids.global}`,undefined,'s1');assert.equal(r.body.item.is_read,false);
 for(let i=0;i<2;i++){r=await call('post',`notices/${ids.global}/read`,{content_revision:1},'s1');assert.equal(r.status,204);}
 assert.equal((await query('SELECT * FROM notice_reads WHERE notice_id=$1',[ids.global])).rows.length,1);
 r=await call('get','notices?unread_only=true',undefined,'s1');assert.equal(r.body.items.length,1);
 r=await call('get','dashboard',undefined,'s1');assert.equal(r.body.notices.unread_count,1);
 r=await call('post',`notices/${ids.global}/read`,{content_revision:1,user_id:accounts.s2},'s1');assert.equal(r.status,400);
 r=await call('post',`notices/${ids.future}/read`,{content_revision:1},'s1');assert.equal(r.status,404);
 r=await call('get',`notices/${ids.global}/readers`);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].name,'s1');assert.equal(r.body.items[0].email,undefined);
 r=await call('get',`notices/${ids.global}/readers`,undefined,'parent');assert.equal(r.status,403);
});
test('lifecycle versions, unread resets and append-only history',async()=>{
 let r=await call('post',`notices/${ids.global}/unpublish`,{expected_version:1,reason:'Edit text'});assert.equal(r.status,409);
 r=await call('post',`notices/${ids.global}/unpublish`,{expected_version:2,reason:'Edit text'});assert.equal(r.status,200);assert.equal(r.body.item.version,3);
 r=await call('get',`notices/${ids.global}`,undefined,'s1');assert.equal(r.status,404);
 const {audience,...withoutAudience}=draft('Assembly');r=await call('put',`notices/${ids.global}`,{...withoutAudience,expected_version:3});assert.equal(r.status,400);
 const edited=draft('Assembly',{body:'Updated assembly text.'});r=await call('put',`notices/${ids.global}`,{...edited,expected_version:3});assert.equal(r.status,200);assert.equal(r.body.item.content_revision,2);
 r=await call('put',`notices/${ids.global}`,{...edited,expected_version:4});assert.equal(r.status,200);assert.equal(r.body.item.content_revision,2);
 r=await call('post',`notices/${ids.global}/publish`,{expected_version:5});assert.equal(r.status,200);
 r=await call('get',`notices/${ids.global}`,undefined,'s1');assert.equal(r.body.item.is_read,false);
 r=await call('post',`notices/${ids.global}/read`,{content_revision:1},'s1');assert.equal(r.status,409);
 r=await call('post',`notices/${ids.global}/read`,{content_revision:2},'s1');assert.equal(r.status,204);
 r=await call('put',`notices/${ids.global}`,{...edited,expected_version:6});assert.equal(r.status,409);
 r=await call('post',`notices/${ids.global}/archive`,{expected_version:6,reason:'Temporarily remove'});assert.equal(r.status,200);
 r=await call('get',`notices/${ids.global}`,undefined,'s1');assert.equal(r.status,404);
 r=await call('post',`notices/${ids.global}/restore`,{expected_version:7,reason:'Restore unchanged announcement'});assert.equal(r.status,200);
 r=await call('post',`notices/${ids.global}/publish`,{expected_version:8});assert.equal(r.status,200);
 r=await call('get',`notices/${ids.global}`,undefined,'s1');assert.equal(r.body.item.is_read,true);
 r=await call('get',`notices/${ids.global}/readers?content_revision=1`);assert.equal(r.body.items.length,1);
 r=await call('get',`notices/${ids.global}/audit`);assert.equal(r.status,200);assert.equal(r.body.items[0].action,'published');
 await assert.rejects(query("UPDATE notice_audit SET reason='rewrite'"),e=>e.code==='23514');
 await assert.rejects(query('DELETE FROM notice_reads'),e=>e.code==='23514');
 await assert.rejects(query('DELETE FROM notices WHERE id=$1',[ids.global]),e=>e.code==='23503');
});
test('dashboards expose only role-scoped counts, money and current snapshots',async()=>{
 let r=await request(app).get('/api/dashboard');assert.equal(r.status,401);
 r=await call('get','dashboard?role=admin',undefined,'s1');assert.equal(r.status,400);
 r=await call('get','dashboard');assert.equal(r.status,200);assert.equal(r.body.stats.profiles.students,3);assert.equal(r.body.stats.profiles.active_teachers,2);assert.equal(r.body.stats.active_accounts.teacher,3);assert.equal(r.body.stats.academic.classes,2);assert.equal(r.body.stats.academic.sections,3);assert.equal(r.body.stats.academic.active_enrollments,3);assert.equal(r.body.attendance_today.recorded,2);assert.equal(r.body.stats.exams.published,2);assert.equal(r.body.stats.exams.draft,1);assert.equal(r.body.stats.notice_management.scheduled,1);assert.equal(r.body.fee_balances.length,2);assert.equal(r.body.today_sessions.length,2);assert.equal(r.headers['cache-control'],'no-store');
 r=await call('get','dashboard',undefined,'t1');assert.equal(r.body.stats.teaching.classes,1);assert.equal(r.body.stats.exams.published,1);assert.equal(r.body.stats.exams.draft,0);assert.equal(r.body.attendance_today.present,1);assert.equal(r.body.attendance_today.absent,0);assert.equal(r.body.today_sessions.length,1);assert.equal(r.body.fee_balances,undefined);assert.equal(r.body.stats.active_accounts,undefined);
 r=await call('get','dashboard',undefined,'t3');assert.equal(r.body.profile_state,'missing');assert.equal(r.body.stats.teaching.classes,0);assert.equal(r.body.today_sessions.length,0);
 for(const who of ['s1','parent']){r=await call('get','dashboard',undefined,who);assert.equal(r.body.stats.family.students,1);assert.equal(r.body.stats.family.published_exams,1);assert.equal(r.body.attendance_today.present,1);assert.equal(r.body.attendance_today.absent,0);assert.equal(r.body.fee_balances.length,1);assert.equal(r.body.fee_balances[0].currency,'INR');assert.equal(r.body.fee_balances[0].outstanding_minor,'7500');assert.equal(r.body.stats.profiles,undefined);assert.equal(r.body.stats.exams,undefined);assert.equal(r.body.students[0].date_of_birth,undefined);assert.equal(r.body.students[0].email,undefined);assert.equal(JSON.stringify(r.body).includes('PRIVATE OTHER CLASS'),false);}
 r=await call('get','dashboard',undefined,'s2');assert.equal(r.body.attendance_today.recorded,0);assert.equal(r.body.attendance_today.absent,0);assert.equal(r.body.fee_balances.length,0);assert.equal(r.body.stats.family.published_exams,0);
});
test('transfers, unlinking and inactive teaching immediately change access',async()=>{
 await query("UPDATE teachers SET employment_status='inactive' WHERE id=$1",[ids.t1]);
 let r=await call('get',`notices/${ids.sectionB}`,undefined,'t1');assert.equal(r.status,404);
 r=await call('get',`notices/${ids.teachers}`,undefined,'t1');assert.equal(r.status,200);
 r=await call('get','dashboard',undefined,'t1');assert.equal(r.body.profile_state,'inactive');assert.equal(r.body.stats.teaching.classes,0);assert.equal(r.body.attendance_today.recorded,0);assert.equal(r.body.today_sessions.length,0);
 await query('UPDATE enrollments SET section_id=$1 WHERE id=$2',[ids.b,ids.s1enrollment]);
 r=await call('get',`notices/${ids.parents}`,undefined,'parent');assert.equal(r.status,404);
 r=await call('get',`notices/${ids.sectionB}`,undefined,'parent');assert.equal(r.status,200);
 await query('DELETE FROM student_parents WHERE student_id=$1 AND parent_id=$2',[ids.s1,ids.parent]);
 r=await call('get','dashboard',undefined,'parent');assert.equal(r.body.stats.family.students,0);assert.equal(r.body.attendance_today.recorded,0);assert.deepEqual(r.body.fee_balances,[]);assert.deepEqual(r.body.today_sessions,[]);
 await query('UPDATE academic_years SET is_current=false WHERE id=$1',[ids.year]);
 r=await call('get','dashboard');assert.equal(r.body.current_year,null);assert.equal(r.body.stats.academic.classes,0);assert.equal(r.body.attendance_today.recorded,0);assert.equal(r.body.fee_balances.length,2);
});
test('notice paging, literal search and validation do not expand scope',async()=>{
 for(let i=0;i<26;i++){
  const n=await insert("INSERT INTO notices(title,body,audience,available_from,created_by,updated_by) VALUES($1,'Plain text','all',CURRENT_TIMESTAMP-interval '1 minute',$2,$2) RETURNING id",[`Extra ${i}`,accounts.admin]);
  await query("UPDATE notices SET status='published',version=2,updated_by=$1 WHERE id=$2",[accounts.admin,n]);
 }
 let r=await call('get','notices?limit=25',undefined,'s2');assert.equal(r.status,200);assert.equal(r.body.items.length,25);
 r=await call('get','notices?limit=25&offset=25',undefined,'s2');assert.ok(r.body.items.length>0);
 r=await call('get','notices?q=%27%20OR%201%3D1--',undefined,'s2');assert.deepEqual(r.body.items,[]);
 for(const path of ['notices?limit=101','notices/not-a-uuid',`notices/${ids.global}/readers?content_revision=999999999999`]){r=await call('get',path);assert.equal(r.status,400);}
});
