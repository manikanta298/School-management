import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
process.env.NODE_ENV='test';process.env.JWT_SECRET='numbering-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';
const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const q=(t,p)=>db.query(t,p);const one=async(t,p)=>(await q(t,p)).rows[0];
after(()=>db.close());
let seq=0;
async function seed(slug){
 const school=slug==='existing-school'?(await one("SELECT id FROM schools WHERE slug='existing-school'")).id:(await one("INSERT INTO schools(name,slug) VALUES($1,$1) RETURNING id",[slug])).id;
 const n=()=>++seq;
 const admin=(await one("INSERT INTO users(name,email,password_hash,role) VALUES('a',$1,'h','admin') RETURNING id",[`a${n()}@example.com`])).id;
 const year=(await one("INSERT INTO academic_years(name,start_date,end_date,is_current,school_id) VALUES('Y','2025-06-01','2026-05-31',true,$1) RETURNING id",[school])).id;
 const klass=(await one("INSERT INTO classes(name,academic_year_id,school_id) VALUES('C',$1,$2) RETURNING id",[year,school])).id;
 const section=(await one("INSERT INTO sections(name,class_id,capacity,school_id) VALUES('A',$1,40,$2) RETURNING id",[klass,school])).id;
 const fs=(await one("INSERT INTO fee_structures(class_id,academic_year_id,name,amount_minor,school_id) VALUES($1,$2,'Tuition',10000,$3) RETURNING id",[klass,year,school])).id;
 const invoices=[];
 for(let i=0;i<2;i++){
  const u=(await one("INSERT INTO users(name,email,password_hash,role) VALUES('s',$1,'h','student') RETURNING id",[`s${n()}@example.com`])).id;
  const st=(await one("INSERT INTO students(user_id,admission_number,admission_date,school_id) VALUES($1,$2,'2025-05-01',$3) RETURNING id",[u,`S${n()}`,school])).id;
  const en=(await one("INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on,status,school_id) VALUES($1,$2,$3,$4,'2025-06-02','active',$5) RETURNING id",[st,year,klass,section,school])).id;
  invoices.push(await one("INSERT INTO fee_invoices(student_id,fee_structure_id,enrollment_id,class_id,academic_year_id,title,amount_minor,currency,issued_on,due_on,created_by,school_id) VALUES($1,$2,$3,$4,$5,'Tuition',10000,'INR','2025-06-02','2025-06-30',$6,$7) RETURNING id,invoice_number",[st,fs,en,klass,year,admin,school]));
 }
 return {school,admin,invoices};
}
const pay=(s,invoice,amount)=>one("INSERT INTO fee_payments(invoice_id,amount_minor,paid_on,method,idempotency_key,recorded_by,school_id) VALUES($1,$2,'2025-06-03','cash',gen_random_uuid(),$3,$4) RETURNING receipt_number",[invoice,amount,s.admin,s.school]);
test('invoice numbers start at 1 and run independently in each school',async()=>{
 const a=await seed('existing-school'),b=await seed('school-b-numbering');
 assert.deepEqual(a.invoices.map(i=>Number(i.invoice_number)),[1,2]);
 assert.deepEqual(b.invoices.map(i=>Number(i.invoice_number)),[1,2]);
 globalThis.__a=a;globalThis.__b=b;
});
test('receipt numbers are per school and a rejected overpayment does not consume a number',async()=>{
 const a=globalThis.__a,b=globalThis.__b;
 assert.equal(Number((await pay(a,a.invoices[0].id,4000)).receipt_number),1);
 await assert.rejects(pay(a,a.invoices[0].id,7000),e=>e.code==='23514');
 assert.equal(Number((await pay(a,a.invoices[0].id,1000)).receipt_number),2,'no gap after the rejected payment');
 assert.equal(Number((await pay(b,b.invoices[0].id,500)).receipt_number),1,'school B has its own sequence');
 assert.equal(Number((await pay(a,a.invoices[1].id,100)).receipt_number),3);
 const counters=(await q("SELECT school_id,name,next_value FROM school_counters ORDER BY name")).rows;
 assert.equal(counters.find(c=>c.school_id===a.school&&c.name==='receipt').next_value,4);
 assert.equal(counters.find(c=>c.school_id===b.school&&c.name==='receipt').next_value,2);
});
test('numbers cannot be altered or duplicated afterwards',async()=>{
 const a=globalThis.__a;
 await assert.rejects(q('UPDATE fee_invoices SET invoice_number=99 WHERE id=$1',[a.invoices[0].id]));
 await assert.rejects(q("UPDATE fee_payments SET receipt_number=99 WHERE invoice_id=$1",[a.invoices[0].id]));
});
