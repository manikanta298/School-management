import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='fee-reports-secret'.repeat(5);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const schoolA=(await query("SELECT id FROM schools WHERE slug='existing-school'")).rows[0].id;
// Fixtures default to the initial school; second-school rows pass school_id explicitly.
for(const {table_name} of (await query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='school_id' AND table_name NOT IN ('school_memberships')")).rows)await query(`ALTER TABLE ${table_name} ALTER COLUMN school_id SET DEFAULT '${schoolA}'`);
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const password='FeeReports!12345',hash=await hashPassword(password),accounts={},tokens={},ids={};
const insert=async(sql,params)=>(await query(sql,params)).rows[0].id;
for(const [key,role] of [['admin','admin'],['parent','parent'],['s1','student'],['s2','student'],['s3','student']]){
 accounts[key]=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key}@example.com`,hash,role]);await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolA,accounts[key],role]);
 const login=await request(app).post('/api/auth/login').send({email:`${key}@example.com`,password});assert.equal(login.status,200);tokens[key]=login.body.accessToken;
}
const call=(method,path,body,who='admin')=>{const req=request(app)[method]('/api/'+path).set('Authorization',`Bearer ${tokens[who]}`);return body?req.send(body):req;};
const day=offset=>{const d=new Date();d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
ids.year=await insert("INSERT INTO academic_years(name,start_date,end_date,is_current) VALUES('Current',CURRENT_DATE-60,CURRENT_DATE+300,true) RETURNING id");
ids.class=await insert('INSERT INTO classes(name,academic_year_id) VALUES($1,$2) RETURNING id',['Grade 1',ids.year]);
ids.section=await insert('INSERT INTO sections(name,class_id,capacity) VALUES($1,$2,40) RETURNING id',['A',ids.class]);
for(const key of ['s1','s2','s3']){
 ids[key]=await insert('INSERT INTO students(user_id,admission_number,admission_date) VALUES($1,$2,CURRENT_DATE-90) RETURNING id',[accounts[key],key.toUpperCase()]);
 await query('INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,CURRENT_DATE-30)',[ids[key],ids.year,ids.class,ids.section]);
}
after(async()=>{await db.close();await pool.end();});
const pay=(invoice,amount_minor,method,paid_on=day(0))=>call('post',`fees/invoices/${invoice}/payments`,{amount_minor,paid_on,method,idempotency_key:randomUUID()});
test('fee structures carry a category and payments accept UPI and online modes',async()=>{
 let r=await call('post','fees/structures',{class_id:ids.class,name:'Default fee',amount_minor:1000});assert.equal(r.status,201);assert.equal(r.body.item.category,'miscellaneous');
 r=await call('post','fees/structures',{class_id:ids.class,name:'Bad',amount_minor:1000,category:'luxury'});assert.equal(r.status,400);
 r=await call('post','fees/structures',{class_id:ids.class,name:'Tuition',amount_minor:10000,category:'tuition'});assert.equal(r.status,201);ids.tuition=r.body.item.id;
 r=await call('post','fees/structures',{class_id:ids.class,name:'Transport',amount_minor:5000,category:'transport'});ids.transport=r.body.item.id;
 r=await call('post','fees/structures',{class_id:ids.class,name:'Books',amount_minor:3000,category:'books'});ids.books=r.body.item.id;
 for(const [student,structure,key] of [['s1','tuition','i1'],['s2','transport','i2'],['s3','books','i3']]){
  r=await call('post','fees/invoices',{student_id:ids[student],fee_structure_id:ids[structure],issued_on:day(-10),due_on:day(-1)});assert.equal(r.status,201,JSON.stringify(r.body));ids[key]=r.body.item.id;
 }
 r=await pay(ids.i1,4000,'upi');assert.equal(r.status,200);
 r=await pay(ids.i3,3000,'cash');assert.equal(r.status,200);
 r=await pay(ids.i2,1000,'online');assert.equal(r.status,200);
 r=await pay(ids.i2,1000,'wire');assert.equal(r.status,400);
});
test('collection reports group exactly, ignore reversals and stay admin-only',async()=>{
 let r=await call('get','fees/reports/collection?group_by=method');assert.equal(r.status,200);
 assert.deepEqual(r.body.items.map(i=>[i.key,i.collected_minor,i.payments]),[['cash','3000',1],['online','1000',1],['upi','4000',1]]);
 r=await call('get','fees/reports/collection?group_by=category');assert.deepEqual(r.body.items.map(i=>[i.key,i.collected_minor]),[['books','3000'],['tuition','4000'],['transport','1000']].sort((a,b)=>a[0]<b[0]?-1:1));
 r=await call('get','fees/reports/collection?group_by=class');assert.deepEqual(r.body.items.map(i=>[i.key,i.currency,i.collected_minor]),[['Grade 1','INR','8000']]);
 r=await call('get','fees/reports/collection');assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].key,day(0).slice(0,7));
 r=await call('get',`fees/reports/collection?group_by=day&from=${day(-3)}&to=${day(-2)}`);assert.equal(r.body.items.length,0);
 const payments=(await call('get',`fees/invoices/${ids.i3}/payments`)).body.items;
 r=await call('post',`fees/invoices/${ids.i3}/payments/${payments[0].id}/reverse`,{reason:'Entered in error'});assert.equal(r.status,204);
 r=await call('get','fees/reports/collection?group_by=method');assert.deepEqual(r.body.items.map(i=>i.key),['online','upi']);
 for(const bad of ['group_by=year',`from=${day(0)}&to=${day(-1)}`,'from=2024-02-30','extra=1']){r=await call('get',`fees/reports/collection?${bad}`);assert.equal(r.status,400);}
 for(const who of ['parent','s1']){r=await call('get','fees/reports/collection',undefined,who);assert.equal(r.status,403);r=await call('get','fees/reports/defaulters',undefined,who);assert.equal(r.status,403);}
});
test('defaulter list shows only overdue unpaid balances per student',async()=>{
 let r=await call('get','fees/reports/defaulters');assert.equal(r.status,200);
 assert.deepEqual(r.body.items.map(i=>[i.admission_number,i.currency,i.outstanding_minor,i.oldest_due_on]),[['S1','INR','6000',day(-1)],['S2','INR','4000',day(-1)],['S3','INR','3000',day(-1)]]);
 r=await call('get','fees/reports/defaulters?limit=1&offset=1');assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].admission_number,'S2');
 r=await pay(ids.i1,6000,'bank_transfer');assert.equal(r.status,200);
 r=await call('get','fees/reports/defaulters');assert.deepEqual(r.body.items.map(i=>i.admission_number),['S2','S3']);
 r=await call('get','fees/reports/defaulters?limit=0');assert.equal(r.status,400);
});
