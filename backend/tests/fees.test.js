import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='fees-test-secret'.repeat(5);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const hash=await hashPassword('FeesPassword!123'),accounts={},tokens={},ids={};
const insert=async(sql,params)=>(await query(sql,params)).rows[0].id;
for(const [key,role] of [['admin','admin'],['teacher','teacher'],['s1','student'],['s2','student'],['parent','parent'],['outsider','parent']]){
 accounts[key]=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key}@example.com`,hash,role]);
 const r=await request(app).post('/api/auth/login').send({email:`${key}@example.com`,password:'FeesPassword!123'});assert.equal(r.status,200);tokens[key]=r.body.accessToken;
}
ids.year=await insert("INSERT INTO academic_years(name,start_date,end_date) VALUES('Fees year','2025-06-01','2026-05-31') RETURNING id");
for(const key of ['c1','c2'])ids[key]=await insert('INSERT INTO classes(name,academic_year_id) VALUES($1,$2) RETURNING id',[key,ids.year]);
for(const [key,cl] of [['a','c1'],['b','c2']])ids[key]=await insert('INSERT INTO sections(name,class_id,capacity) VALUES($1,$2,40) RETURNING id',[key,ids[cl]]);
for(const key of ['s1','s2']){
 ids[key]=await insert('INSERT INTO students(user_id,admission_number,admission_date) VALUES($1,$2,$3) RETURNING id',[accounts[key],key.toUpperCase(),'2025-01-01']);
 ids[key+'enrollment']=await insert('INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,$5) RETURNING id',[ids[key],ids.year,ids.c1,ids.a,'2025-06-01']);
}
ids.parent=await insert('INSERT INTO parents(user_id) VALUES($1) RETURNING id',[accounts.parent]);await query("INSERT INTO student_parents(student_id,parent_id,relationship) VALUES($1,$2,'guardian')",[ids.s1,ids.parent]);
const call=(method,path,body,who='admin')=>{const req=request(app)[method]('/api/fees/'+path).set('Authorization',`Bearer ${tokens[who]}`);return body?req.send(body):req;};
const structure=(name='Tuition',amount_minor=10001,currency='INR')=>({class_id:ids.c1,name,amount_minor,currency,active:true});
const invoice=(student='s1',fee='fee')=>({student_id:ids[student],fee_structure_id:ids[fee],issued_on:'2025-06-01',due_on:'2025-06-30'});
const payment=(amount_minor,key=randomUUID())=>({amount_minor,paid_on:'2025-06-02',method:'cash',reference:null,idempotency_key:key});
after(async()=>{await db.close();await pool.end();});
test('fee structures and invoice snapshots enforce scope and exact amounts',async()=>{
 let r=await request(app).get('/api/fees/invoices');assert.equal(r.status,401);
 r=await call('get','invoices',undefined,'teacher');assert.equal(r.status,403);
 r=await call('post','structures',structure());assert.equal(r.status,201);ids.fee=r.body.item.id;
 r=await call('post','structures',structure('tuition'));assert.equal(r.status,409);
 for(const amount of [0,-1,1.5,1000000001]){r=await call('post','structures',structure('Bad',amount));assert.equal(r.status,400);}
 r=await call('post','structures',structure('<script>'));assert.equal(r.status,400);
 r=await call('post','invoices',invoice());assert.equal(r.status,201);ids.invoice=r.body.item.id;assert.equal(r.body.item.amount_minor,10001);assert.equal(r.body.item.balance_minor,10001);assert.equal(r.body.item.created_by,undefined);assert.equal(r.body.item.status,'overdue');
 r=await call('post','invoices',invoice());assert.equal(r.status,409);
 r=await call('put',`structures/${ids.fee}`,structure('New tuition',20002,'USD'));assert.equal(r.status,200);
 r=await call('get',`invoices/${ids.invoice}`);assert.equal(r.body.item.title,'Tuition');assert.equal(r.body.item.currency,'INR');assert.equal(r.body.item.amount_minor,10001);
 r=await call('post','invoices',invoice('s2'));assert.equal(r.status,201);ids.otherInvoice=r.body.item.id;assert.equal(r.body.item.currency,'USD');
 for(const who of ['s1','parent']){r=await call('get','invoices',undefined,who);assert.equal(r.body.items.length,1);r=await call('get',`invoices/${ids.otherInvoice}`,undefined,who);assert.equal(r.status,404);r=await call('get','structures',undefined,who);assert.equal(r.status,403);}
 r=await call('get','invoices',undefined,'outsider');assert.deepEqual(r.body.items,[]);
 r=await call('get',`invoices?student_id=${ids.s2}`,undefined,'s1');assert.deepEqual(r.body.items,[]);
 r=await call('get',`summary?student_id=${ids.s2}`,undefined,'parent');assert.deepEqual(r.body.items,[]);
 r=await call('post','invoices',invoice(),'s1');assert.equal(r.status,403);
 r=await call('get','invoices/not-a-uuid');assert.equal(r.status,400);
 r=await call('get','invoices?limit=0');assert.equal(r.status,400);
});
test('payment retries are idempotent and overpayments cannot alter balances',async()=>{
 const key=randomUUID(),body=payment(4000,key);let r=await call('post',`invoices/${ids.invoice}/payments`,body);assert.equal(r.status,200);ids.payment=r.body.payment_id;assert.equal(r.body.replayed,false);
 r=await call('post',`invoices/${ids.invoice}/payments`,body);assert.equal(r.status,200);assert.equal(r.body.payment_id,ids.payment);assert.equal(r.body.replayed,true);
 r=await call('post',`invoices/${ids.invoice}/payments`,{...body,amount_minor:3999});assert.equal(r.status,409);
 r=await call('post',`invoices/${ids.otherInvoice}/payments`,body);assert.equal(r.status,409);
 r=await call('get',`invoices/${ids.invoice}`);assert.equal(r.body.item.paid_minor,4000);assert.equal(r.body.item.balance_minor,6001);
 r=await call('post',`invoices/${ids.invoice}/payments`,payment(6002));assert.equal(r.status,400);
 r=await call('post',`invoices/${ids.invoice}/payments`,{...payment(1),paid_on:'2025-05-31'});assert.equal(r.status,400);
 r=await call('post',`invoices/${ids.invoice}/payments`,{...payment(1),paid_on:'2099-01-01'});assert.equal(r.status,400);
 r=await call('post',`invoices/${ids.invoice}/payments`,payment(6001));assert.equal(r.status,200);ids.finalPayment=r.body.payment_id;
 r=await call('get',`invoices/${ids.invoice}`,undefined,'parent');assert.equal(r.body.item.balance_minor,0);assert.equal(r.body.item.status,'paid');
 r=await call('post',`invoices/${ids.invoice}/payments`,payment(1));assert.equal(r.status,400);
 r=await call('get',`invoices/${ids.invoice}/payments`,undefined,'s1');assert.equal(r.body.items.length,2);assert.equal(r.body.items[0].recorded_by,undefined);
 r=await call('get',`invoices/${ids.invoice}/payments`,undefined,'s2');assert.equal(r.status,404);
 r=await call('post',`invoices/${ids.invoice}/payments`,payment(1),'parent');assert.equal(r.status,403);
 r=await call('get',`invoices/${ids.invoice}/events`);assert.equal(r.body.items.length,3);
 r=await call('get',`invoices/${ids.invoice}/events`,undefined,'s1');assert.equal(r.status,403);
});
test('reversals and voids preserve audit history and permit corrected reissue',async()=>{
 let r=await call('post',`invoices/${ids.invoice}/void`,{reason:'Wrong amount'});assert.equal(r.status,400);
 r=await call('post',`invoices/${ids.invoice}/payments/${ids.payment}/reverse`,{reason:'x'});assert.equal(r.status,400);
 r=await call('post',`invoices/${ids.invoice}/payments/${ids.payment}/reverse`,{reason:'Duplicate cash entry'});assert.equal(r.status,204);
 r=await call('post',`invoices/${ids.invoice}/payments/${ids.payment}/reverse`,{reason:'Duplicate again'});assert.equal(r.status,409);
 r=await call('get',`invoices/${ids.invoice}`);assert.equal(r.body.item.balance_minor,4000);
 r=await call('post',`invoices/${ids.otherInvoice}/payments/${ids.finalPayment}/reverse`,{reason:'Wrong invoice pairing'});assert.equal(r.status,409);
 r=await call('post',`invoices/${ids.invoice}/payments/${ids.finalPayment}/reverse`,{reason:'Incorrect receipt entry'});assert.equal(r.status,204);
 r=await call('post',`invoices/${ids.invoice}/void`,{reason:'Correct and reissue fee'});assert.equal(r.status,204);
 r=await call('get',`invoices/${ids.invoice}`,undefined,'s1');assert.equal(r.body.item.status,'void');assert.equal(r.body.item.balance_minor,0);
 r=await call('post',`invoices/${ids.invoice}/payments`,payment(1));assert.equal(r.status,400);
 r=await call('post',`invoices/${ids.invoice}/void`,{reason:'Repeated void'});assert.equal(r.status,409);
 r=await call('post','invoices',invoice());assert.equal(r.status,201);ids.reissued=r.body.item.id;assert.equal(r.body.item.currency,'USD');assert.equal(r.body.item.amount_minor,20002);
 await assert.rejects(query('UPDATE fee_invoices SET amount_minor=1 WHERE id=$1',[ids.reissued]),e=>e.code==='23514');
 await assert.rejects(query("UPDATE fee_payments SET amount_minor=1 WHERE id=$1",[ids.payment]),e=>e.code==='23514');
 await assert.rejects(query("UPDATE fee_events SET reason='rewrite'"),e=>e.code==='23514');
 await assert.rejects(query('DELETE FROM fee_events'),e=>e.code==='23514');
 await assert.rejects(query('DELETE FROM fee_payments WHERE id=$1',[ids.payment]),e=>e.code==='23503');
 await assert.rejects(query('DELETE FROM fee_invoices WHERE id=$1',[ids.invoice]),e=>e.code==='23503');
});
test('currency-separated summaries, transfer history and family unlinking',async()=>{
 let r=await call('get','summary');assert.equal(r.status,200);assert.equal(r.body.items.length,2);const usd=r.body.items.find(t=>t.currency==='USD'),inr=r.body.items.find(t=>t.currency==='INR');assert.equal(usd.billed_minor,'40004');assert.equal(usd.outstanding_minor,'40004');assert.equal(usd.overdue_minor,'40004');assert.equal(inr.void_count,1);assert.equal(inr.billed_minor,'0');
 r=await call('get','summary',undefined,'parent');assert.equal(r.body.items.find(t=>t.currency==='USD').billed_minor,'20002');
 await query('UPDATE enrollments SET class_id=$1,section_id=$2 WHERE id=$3',[ids.c2,ids.b,ids.s1enrollment]);
 r=await call('get',`invoices/${ids.reissued}`,undefined,'s1');assert.equal(r.body.item.class_id,ids.c1);
 await assert.rejects(query('DELETE FROM enrollments WHERE id=$1',[ids.s1enrollment]),e=>e.code==='23503');
 await assert.rejects(query('UPDATE enrollments SET enrolled_on=$1 WHERE id=$2',['2025-06-02',ids.s1enrollment]),e=>e.code==='23514');
 r=await call('post','invoices',invoice('s1'));assert.equal(r.status,400);
 await query('DELETE FROM student_parents WHERE student_id=$1 AND parent_id=$2',[ids.s1,ids.parent]);
 r=await call('get',`invoices/${ids.reissued}`,undefined,'parent');assert.equal(r.status,404);
 r=await call('get','summary',undefined,'parent');assert.deepEqual(r.body.items,[]);
 r=await call('put',`structures/${ids.fee}`,{...structure(),active:false});assert.equal(r.status,200);
 r=await call('post','invoices',invoice('s2'));assert.equal(r.status,400);
});
test('money conversion uses exact minor units and rejects rounding inputs',async()=>{
 const {parseMoney,formatMoney}=await import('../../frontend/src/api/money.js');
 assert.equal(parseMoney('100.01'),10001);assert.equal(parseMoney('0.01'),1);assert.equal(parseMoney('10000000.00'),1000000000);
 for(const amount of ['0','-1','1.001','1e2','Infinity','10000000.01'])assert.throws(()=>parseMoney(amount));
 assert.equal(formatMoney('9007199254740993123','INR'),'INR 90,07,19,92,54,74,09,931.23');
});
