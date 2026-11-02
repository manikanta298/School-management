import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='demo-security-test-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');
const db=new PGlite();const schema=await readFile(new URL('../database/schema.sql',import.meta.url),'utf8');await db.exec(schema);
const query=async(text,params)=>{const r=params?await db.query(text,params):(await db.exec(text)).at(-1);return {...r,rowCount:r.rows?.length||r.affectedRows||0};};
pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {issue,hashPassword}=await import('../src/services/auth.js');const {seedDemo,DEMO_YEAR_ID}=await import('../src/services/demo.js');
const admin=(await query("INSERT INTO users(name,email,password_hash,role) VALUES('QA Administrator','qa-admin@example.invalid',$1,'admin') RETURNING *",[await hashPassword('QA-Only-Strong-Password!')])).rows[0];
const adminToken=(await issue(admin)).accessToken;
const call=(method,path,token=adminToken,body)=>{const r=request(app)[method]('/api/'+path).set('Origin',process.env.FRONTEND_ORIGIN);if(token)r.set('Authorization',`Bearer ${token}`);return body?r.send(body):r;};
after(async()=>{await db.close();await pool.end();});
test('demo import requires administrator, trusted origin and explicit confirmation',async()=>{
 assert.equal((await call('post','demo',null,{confirmation:'LOAD_DEMO_DATA'})).status,401);
 const parent=(await query("INSERT INTO users(name,email,password_hash,role) VALUES('Outsider','outsider@example.invalid',$1,'parent') RETURNING *",[admin.password_hash])).rows[0];
 assert.equal((await call('post','demo',(await issue(parent)).accessToken,{confirmation:'LOAD_DEMO_DATA'})).status,403);
 assert.equal((await call('post','demo',adminToken,{confirmation:'LOAD_DEMO_DATA'}).set('Origin','https://untrusted.example')).status,403);
 assert.equal((await call('post','demo',adminToken,{confirmation:'other'})).status,400);
 const r=await call('post','demo',adminToken,{confirmation:'LOAD_DEMO_DATA'});assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.counts.students,16);
 assert.equal((await call('post','demo',adminToken,{confirmation:'LOAD_DEMO_DATA'})).status,429);
});
test('populated modules, live dashboards, invoices, report cards and scoped family access flow end to end',async()=>{
 for(const path of ['dashboard','students','parents','teachers','academic/academic-years','fees/structures','fees/invoices','fees/summary','exams','exams/grading-scales','timetable/calendar','timetable/rooms','notices','users']){const r=await call('get',path);assert.equal(r.status,200,path+': '+JSON.stringify(r.body));assert.match(r.headers['cache-control'],/no-store/);}
 const dashboard=(await call('get','dashboard')).body;assert.equal(dashboard.stats.profiles.students,16);assert.equal(dashboard.stats.profiles.active_teachers,3);const weekday=(await query('SELECT extract(isodow FROM CURRENT_DATE)::int AS day')).rows[0].day;assert.equal(dashboard.attendance_today.recorded,weekday<=5?16:0);assert.equal(dashboard.stats.exams.published,2);assert.equal(dashboard.fee_balances.length,2);
 const invoice=(await query('SELECT id FROM fee_invoices ORDER BY invoice_number LIMIT 1')).rows[0].id;
 for(const path of [`fees/invoices/${invoice}`,`fees/invoices/${invoice}/payments`,`fees/invoices/${invoice}/events`])assert.equal((await call('get',path)).status,200,path);
 const student=(await query("SELECT u.*,s.id AS student_id FROM users u JOIN students s ON s.user_id=u.id WHERE email='demo.student1@example.invalid'")).rows[0];
 const token=(await issue(student)).accessToken;
 const list=(await call('get','students',token)).body;assert.ok(JSON.stringify(list).includes('Demo · Aarav Sharma'));assert.ok(!JSON.stringify(list).includes('Demo · Diya Patel'));
 assert.equal((await call('get','users',token)).status,403);assert.equal((await call('get','notices/manage',token)).status,403);
 const exam=(await query("SELECT id FROM exams WHERE status='published' AND class_id=(SELECT class_id FROM enrollments WHERE student_id=$1)",[student.student_id])).rows[0].id;
 const result=await call('get',`exams/${exam}/my-results`,token);assert.equal(result.status,200,JSON.stringify(result.body));assert.ok(JSON.stringify(result.body).includes('DEMO · Mathematics'));
 const foreign=(await query('SELECT student_id FROM enrollments WHERE class_id<>(SELECT class_id FROM enrollments WHERE student_id=$1) LIMIT 1',[student.student_id])).rows[0].student_id;
 assert.equal((await call('get',`students/${foreign}`,token)).status,404);
 const date=dashboard.calendar.today,section=(await query('SELECT id FROM sections ORDER BY id LIMIT 1')).rows[0].id;
 for(const path of [`attendance/register?section_id=${section}&date=${date}`,`attendance/audit?section_id=${section}&date=${date}`])assert.equal((await call('get',path)).status,200,path);
 const parent=(await query("SELECT * FROM users WHERE email='demo.parent1@example.invalid'")).rows[0];const pt=(await issue(parent)).accessToken;assert.equal((await call('get','dashboard',pt)).body.stats.family.students,2);
 const teacher=(await query("SELECT * FROM users WHERE email='demo.teacher1@example.invalid'")).rows[0];const tt=(await issue(teacher)).accessToken;assert.equal((await call('get','dashboard',tt)).body.stats.teaching.classes,2);assert.equal((await call('get','fees/invoices',tt)).status,403);
 const countsBefore=(await query('SELECT count(*)::int AS n FROM users')).rows[0].n;assert.equal((await seedDemo(admin.id)).created,false);assert.equal((await query('SELECT count(*)::int AS n FROM users')).rows[0].n,countsBefore);
 assert.equal((await query("SELECT count(*)::int AS n FROM users WHERE role='admin'")).rows[0].n,1);
 for(const table of ['attendance_audit','fee_events','exam_events','exam_mark_audit','timetable_audit','notice_audit','notice_reads'])assert.ok((await query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n>0,table);
});
test('failed demo import rolls back all inserted records and preserves an existing current year',async()=>{
 const separate=new PGlite();await separate.exec(schema);const originalConnect=pool.connect;
 const q=async(sql,args)=>{const r=args?await separate.query(sql,args):(await separate.exec(sql)).at(-1);return {...r,rowCount:r.rows?.length||r.affectedRows||0};};
 await q("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Existing admin','existing@example.invalid',$2,'admin')",[admin.id,admin.password_hash]);
 await q("INSERT INTO academic_years(name,start_date,end_date,is_current) VALUES('Real current year',CURRENT_DATE-150,CURRENT_DATE+200,true)");
 pool.connect=async()=>({query:async(sql,args)=>{if(sql.startsWith('INSERT INTO teachers'))throw new Error('Injected failure');return q(sql,args);},release(){}});
 try{await assert.rejects(seedDemo(admin.id),/Injected failure/);assert.equal((await q('SELECT count(*)::int AS n FROM users')).rows[0].n,1);assert.equal((await q('SELECT id FROM academic_years WHERE id=$1',[DEMO_YEAR_ID])).rowCount,0);assert.equal((await q('SELECT name FROM academic_years WHERE is_current')).rows[0].name,'Real current year');pool.connect=async()=>({query:q,release(){}});const result=await seedDemo(admin.id);assert.equal(result.is_current,false);assert.equal((await q('SELECT name FROM academic_years WHERE is_current')).rows[0].name,'Real current year');}
 finally{pool.connect=originalConnect;await separate.close();}
});
