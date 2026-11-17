import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='fees-test-secret'.repeat(5);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const schoolA=(await query("SELECT id FROM schools WHERE slug='existing-school'")).rows[0].id;
// Fixtures default to the initial school; second-school rows pass school_id explicitly.
for(const {table_name} of (await query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='school_id' AND table_name NOT IN ('school_memberships')")).rows)await query(`ALTER TABLE ${table_name} ALTER COLUMN school_id SET DEFAULT '${schoolA}'`);
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const hash=await hashPassword('FeesPassword!123'),accounts={},tokens={},ids={};
const insert=async(sql,params)=>(await query(sql,params)).rows[0].id;
for(const [key,role] of [['admin','admin'],['teacher','teacher'],['s1','student'],['s2','student'],['parent','parent'],['outsider','parent']]){
 accounts[key]=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key}@example.com`,hash,role]);await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolA,accounts[key],role]);
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
test('fees are isolated between schools and cannot reference another school',async()=>{
 const {rows:[sb]}=await query("INSERT INTO schools(name,slug) VALUES('School B','school-b') RETURNING id");const schoolB=sb.id;
 const mk=async(name,role)=>{const id=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[name,`${name}@example.com`,hash,role]);await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolB,id,role]);return id;};
 const adminB=await mk('adminb','admin'),studentBUser=await mk('studentb','student');
 let r=await request(app).post('/api/auth/login').send({email:'adminb@example.com',password:'FeesPassword!123'});assert.equal(r.status,200);tokens.adminB=r.body.accessToken;
 ids.yearB=await insert('INSERT INTO academic_years(school_id,name,start_date,end_date) VALUES($1,$2,$3,$4) RETURNING id',[schoolB,'B year','2025-06-01','2026-05-31']);
 ids.classB=await insert('INSERT INTO classes(school_id,name,academic_year_id) VALUES($1,$2,$3) RETURNING id',[schoolB,'B1',ids.yearB]);
 const sectionB=await insert('INSERT INTO sections(school_id,name,class_id,capacity) VALUES($1,$2,$3,40) RETURNING id',[schoolB,'A',ids.classB]);
 ids.sB=await insert('INSERT INTO students(school_id,user_id,admission_number,admission_date) VALUES($1,$2,$3,$4) RETURNING id',[schoolB,studentBUser,'B-1','2025-01-01']);
 await insert('INSERT INTO enrollments(school_id,student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[schoolB,ids.sB,ids.yearB,ids.classB,sectionB,'2025-06-01']);
 // School A data to attack.
 r=await call('post','structures',structure('Isolation fee'));assert.equal(r.status,201);const feeA=r.body.item.id;
 const uA=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',['studenta2','studenta2@example.com',hash,'student']);await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,'student','active',true)",[schoolA,uA]);
 ids.sA2=await insert('INSERT INTO students(user_id,admission_number,admission_date) VALUES($1,$2,$3) RETURNING id',[uA,'A-ISO','2025-01-01']);
 await insert('INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,$5) RETURNING id',[ids.sA2,ids.year,ids.c1,ids.a,'2025-06-01']);
 r=await call('post','invoices',{student_id:ids.sA2,fee_structure_id:feeA,issued_on:'2025-06-01',due_on:'2025-06-30'});assert.equal(r.status,201);const invA=r.body.item.id;
 const key=randomUUID();r=await call('post',`invoices/${invA}/payments`,payment(500,key));assert.equal(r.status,200);const payA=r.body.payment_id;
 // School B admin cannot see or touch School A fee data.
 r=await call('get','structures',undefined,'adminB');assert.equal(r.status,200);assert.deepEqual(r.body.items,[]);
 r=await call('get','invoices',undefined,'adminB');assert.deepEqual(r.body.items,[]);
 for(const [m,path,body] of [['get',`invoices/${invA}`],['get',`invoices/${invA}/payments`],['get',`invoices/${invA}/events`],['post',`invoices/${invA}/payments`,payment(100)],['post',`invoices/${invA}/void`,{reason:'cross school'}],['post',`invoices/${invA}/payments/${payA}/reverse`,{reason:'cross school'}]]){r=await call(m,path,body,'adminB');assert.equal(r.status,404,`${m} ${path}`);}
 r=await call('post','structures',{class_id:ids.c1,name:'Steal',amount_minor:100,currency:'INR',active:true},'adminB');assert.equal(r.status,404);
 r=await call('put',`structures/${feeA}`,structure('Hijack'),'adminB');assert.equal(r.status,404);
 r=await call('post','invoices',{student_id:ids.sA2,fee_structure_id:feeA,issued_on:'2025-06-01',due_on:'2025-06-30'},'adminB');assert.equal(r.status,400);
 // School A data is untouched by the rejected attempts.
 r=await call('get',`invoices/${invA}/payments`);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].reversed_at,null);
 // School B can run its own fee cycle, and reuse a payment retry key without clashing with School A.
 r=await call('post','structures',{class_id:ids.classB,name:'B tuition',amount_minor:7000,currency:'INR',active:true},'adminB');assert.equal(r.status,201);
 r=await call('post','invoices',{student_id:ids.sB,fee_structure_id:r.body.item.id,issued_on:'2025-06-01',due_on:'2025-06-30'},'adminB');assert.equal(r.status,201);const invB=r.body.item.id;
 r=await call('post',`invoices/${invB}/payments`,payment(500,key),'adminB');assert.equal(r.status,200);assert.equal(r.body.replayed,false);
 r=await call('get','invoices',undefined,'adminB');assert.deepEqual(r.body.items.map(i=>i.id),[invB]);
 r=await call('get',`invoices/${invB}`);assert.equal(r.status,404);
 r=await call('get','summary',undefined,'adminB');assert.equal(r.body.items[0].billed_minor,'7000');
 for(const rep of ['reports/collection?group_by=method&from=2025-01-01&to=2025-12-31','reports/defaulters']){r=await call('get',rep,undefined,'adminB');assert.equal(r.status,200);assert.ok(r.body.items.every(i=>JSON.stringify(i).includes('B-1')||i.collected_minor==='500'),rep);}
 // Database-level guards: cross-school references are rejected even when written directly.
 r=await call('post','structures',structure('Iso2'));assert.equal(r.status,201);const fee2=r.body.item.id;
 await assert.rejects(query(`INSERT INTO fee_invoices(school_id,student_id,fee_structure_id,enrollment_id,class_id,academic_year_id,title,amount_minor,currency,issued_on,due_on,created_by) SELECT $1,s.id,f.id,e.id,f.class_id,f.academic_year_id,f.name,f.amount_minor,f.currency,CURRENT_DATE,CURRENT_DATE,$2 FROM fee_structures f JOIN enrollments e ON e.class_id=f.class_id JOIN students s ON s.id=e.student_id WHERE f.id=$3 AND s.id=$4 AND e.status='active' LIMIT 1`,[schoolB,adminB,fee2,ids.sA2]),/violates foreign key constraint "fee_invoices_(student|structure|enrollment|class|year)_same_school_fk"/);
 await assert.rejects(query("INSERT INTO fee_payments(school_id,invoice_id,amount_minor,paid_on,method,idempotency_key,recorded_by) VALUES($1,$2,1,CURRENT_DATE,'cash',$3,$4)",[schoolB,invA,randomUUID(),adminB]),/violates foreign key constraint "fee_payments_invoice_same_school_fk"/);
});

test('receipts show school, student, payment and balance with the same access rules as invoices',async()=>{
 const inv=ids.reissued,url=(p)=>`invoices/${inv}/payments/${p}/receipt`;
 let r=await call('get',`invoices/${inv}`);assert.equal(r.status,200);const base=r.body.item.paid_minor,total=r.body.item.amount_minor;
 r=await call('post',`invoices/${inv}/payments`,payment(3000));assert.equal(r.status,200,JSON.stringify(r.body));const first=r.body.payment_id;
 r=await call('post',`invoices/${inv}/payments`,payment(2000));assert.equal(r.status,200);const second=r.body.payment_id;
 r=await call('get',url(second));assert.equal(r.status,200,JSON.stringify(r.body));
 const x=r.body.item;
 assert.equal(x.amount_minor,2000);assert.equal(x.invoice_amount_minor,total);assert.equal(x.paid_to_date_minor,base+5000);assert.equal(x.balance_after_minor,total-base-5000);
 assert.equal(x.reversed_at,null);assert.ok(x.school_name&&x.student_name&&x.admission_number&&x.receipt_number&&x.invoice_number);assert.equal(x.recorded_by,undefined);assert.equal(x.idempotency_key,undefined);
 r=await call('get',url(first));assert.equal(r.body.item.paid_to_date_minor,base+3000);assert.equal(r.body.item.balance_after_minor,total-base-3000);
 for(const who of ['parent','s1','s2','outsider','teacher']){const invoiceStatus=(await call('get',`invoices/${inv}`,null,who)).status;r=await call('get',url(second),null,who);assert.equal(r.status,invoiceStatus,`${who} receipt access must match invoice access`);if(r.status===200)assert.equal(r.body.item.balance_after_minor,total-base-5000);}
 r=await call('get',url(second),null,'s1');assert.equal(r.status,200);
 for(const who of ['outsider','s2','teacher']){r=await call('get',url(second),null,who);assert.notEqual(r.status,200,who);}
 r=await call('get',url('00000000-0000-4000-8000-000000000000'));assert.equal(r.status,404);
 r=await call('get',url('not-an-id'));assert.equal(r.status,400);
 r=await request(app).get(`/api/fees/${url(second)}`);assert.equal(r.status,401);
});
