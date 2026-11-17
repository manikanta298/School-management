import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const databaseUrl=process.env.POSTGRES_TEST_DATABASE_URL;
if(!databaseUrl)throw new Error('POSTGRES_TEST_DATABASE_URL must point to a disposable local PostgreSQL database');
const parsedUrl=new URL(databaseUrl);
if(!['localhost','127.0.0.1'].includes(parsedUrl.hostname))throw new Error('PostgreSQL concurrency tests only run against localhost');

const schema=`school_it_${process.pid}_${randomBytes(4).toString('hex')}`;
const admin=new pg.Client({connectionString:databaseUrl});
let testPool,adminConnected=false,schemaCreated=false;
try{
 await admin.connect();adminConnected=true;
 await admin.query(`CREATE SCHEMA "${schema}"`);
 schemaCreated=true;
 testPool=new pg.Pool({connectionString:databaseUrl,options:`-c search_path=${schema},public`,max:4});
 const client=await testPool.connect();
 try{
  await client.query('BEGIN');
  await client.query('CREATE TABLE schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const migrations=(await readdir(new URL('../database/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort();
  for(const name of migrations){
   await client.query(await readFile(new URL(`../database/migrations/${name}`,import.meta.url),'utf8'));
   await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
  }
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}

 const insert=async(sql,values)=>(await testPool.query(sql,values)).rows[0];
 const schoolId=(await insert("SELECT id FROM schools WHERE slug='existing-school'",[])).id;
 const year=(await insert("INSERT INTO academic_years(name,start_date,end_date,school_id) VALUES('Concurrency year',CURRENT_DATE-1,CURRENT_DATE+30,$1) RETURNING id",[schoolId])).id;
 const studentIds=[];
 for(let i=1;i<=3;i++){
  const user=(await insert("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,'test-hash','student') RETURNING id",[`Pupil ${i}`,`pupil${i}@example.test`])).id;
  studentIds.push((await insert('INSERT INTO students(user_id,admission_number,admission_date,school_id) VALUES($1,$2,CURRENT_DATE-1,$3) RETURNING id',[user,`P${i}`,schoolId])).id);
 }
 const vehicle=(await insert("INSERT INTO transport_vehicles(registration_number,capacity,school_id) VALUES('TEST-1',1,$1) RETURNING id",[schoolId])).id;
 const routeA=(await insert('INSERT INTO transport_routes(name,vehicle_id,school_id) VALUES($1,$2,$3) RETURNING id',['Route A',vehicle,schoolId])).id;
 const routeB=(await insert('INSERT INTO transport_routes(name,school_id) VALUES($1,$2) RETURNING id',['Route B',schoolId])).id;
 const stopA=(await insert('INSERT INTO transport_stops(route_id,name,sequence,school_id) VALUES($1,$2,1,$3) RETURNING id',[routeA,'A',schoolId])).id;
 const stopB=(await insert('INSERT INTO transport_stops(route_id,name,sequence,school_id) VALUES($1,$2,1,$3) RETURNING id',[routeB,'B',schoolId])).id;
 await testPool.query('INSERT INTO transport_allocations(student_id,stop_id,academic_year_id,school_id) VALUES($1,$2,$3,$4)',[studentIds[0],stopB,year,schoolId]);

 const operations=await Promise.allSettled([
  testPool.query('INSERT INTO transport_allocations(student_id,stop_id,academic_year_id,school_id) VALUES($1,$2,$3,$4)',[studentIds[1],stopA,year,schoolId]),
  testPool.query('UPDATE transport_routes SET vehicle_id=$1 WHERE id=$2',[vehicle,routeB]),
 ]);
 const committed=operations.filter(result=>result.status==='fulfilled').length;
 const rejected=operations.filter(result=>result.status==='rejected');
 assert.equal(committed,1,'exactly one concurrent operation may consume the final seat');
 assert.equal(rejected.length,1);
 assert.equal(rejected[0].reason.code,'23514');
 const load=(await testPool.query('SELECT count(*)::int AS total FROM transport_allocations a JOIN transport_stops s ON s.id=a.stop_id JOIN transport_routes r ON r.id=s.route_id WHERE r.vehicle_id=$1 AND a.academic_year_id=$2',[vehicle,year])).rows[0].total;
 assert.equal(load,1,'committed vehicle load must not exceed capacity');
 process.stdout.write('PostgreSQL transport capacity race: passed (one commit, one capacity rejection).\n');

 // Fee payments: concurrent payments must never exceed the invoice balance; receipts stay unique; idempotency keys dedupe.
 const adminUser=(await insert("INSERT INTO users(name,email,password_hash,role) VALUES('Fee admin','fee-admin@example.test','test-hash','admin') RETURNING id",[])).id;
 const klass=(await insert('INSERT INTO classes(name,academic_year_id,school_id) VALUES($1,$2,$3) RETURNING id',['Fee class',year,schoolId])).id;
 const section=(await insert('INSERT INTO sections(name,class_id,capacity,school_id) VALUES($1,$2,40,$3) RETURNING id',['A',klass,schoolId])).id;
 const enrollment=(await insert("INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on,status,school_id) VALUES($1,$2,$3,$4,CURRENT_DATE-1,'active',$5) RETURNING id",[studentIds[2],year,klass,section,schoolId])).id;
 const structure=(await insert('INSERT INTO fee_structures(class_id,academic_year_id,name,amount_minor,school_id) VALUES($1,$2,$3,10000,$4) RETURNING id',[klass,year,'Tuition',schoolId])).id;
 const invoice=(await insert("INSERT INTO fee_invoices(student_id,fee_structure_id,enrollment_id,class_id,academic_year_id,title,amount_minor,currency,issued_on,due_on,created_by,school_id) VALUES($1,$2,$3,$4,$5,'Tuition',10000,'INR',CURRENT_DATE-1,CURRENT_DATE+10,$6,$7) RETURNING id",[studentIds[2],structure,enrollment,klass,year,adminUser,schoolId])).id;
 const pay=(amount,key=null)=>testPool.query("INSERT INTO fee_payments(invoice_id,amount_minor,paid_on,method,idempotency_key,recorded_by,school_id) VALUES($1,$2,CURRENT_DATE,'cash',COALESCE($3::uuid,gen_random_uuid()),$4,$5) RETURNING receipt_number",[invoice,amount,key,adminUser,schoolId]);
 const attempts=await Promise.allSettled(Array.from({length:6},()=>pay(4000)));
 const accepted=attempts.filter(r=>r.status==='fulfilled'),refused=attempts.filter(r=>r.status==='rejected');
 assert.equal(accepted.length,2,'only two 4000 payments fit into a 10000 invoice');
 assert.ok(refused.every(r=>r.reason.code==='23514'),'overpayments are rejected by the payment guard');
 const paid=Number((await testPool.query('SELECT coalesce(sum(amount_minor),0) AS total FROM fee_payments WHERE invoice_id=$1 AND reversed_at IS NULL',[invoice])).rows[0].total);
 assert.equal(paid,8000,'collected amount must never exceed the invoice');
 const receipts=accepted.map(r=>Number(r.value.rows[0].receipt_number)).sort((x,y)=>x-y);assert.deepEqual(receipts,[1,2],'receipt numbers are per school, consecutive and gap-free even though 4 payments were rejected');
 const key='11111111-1111-4111-8111-111111111111';
 const replays=await Promise.allSettled([pay(1000,key),pay(1000,key),pay(1000,key)]);
 assert.equal(replays.filter(r=>r.status==='fulfilled').length,1,'one payment per idempotency key');
 assert.ok(replays.filter(r=>r.status==='rejected').every(r=>r.reason.code==='23505'));
 assert.equal(Number((await testPool.query('SELECT sum(amount_minor) AS total FROM fee_payments WHERE invoice_id=$1 AND reversed_at IS NULL',[invoice])).rows[0].total),9000);
 assert.deepEqual((await testPool.query('SELECT receipt_number FROM fee_payments WHERE invoice_id=$1 ORDER BY receipt_number',[invoice])).rows.map(r=>Number(r.receipt_number)),[1,2,3],'replays that were rejected did not consume receipt numbers');
 process.stdout.write('PostgreSQL fee payment race: passed (no overpayment, unique receipts, idempotent replays).\n');
}finally{
 try{if(testPool)await testPool.end();}
 finally{if(adminConnected){try{if(schemaCreated)await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}finally{await admin.end();}}}
}
