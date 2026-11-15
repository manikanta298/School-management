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
 const year=(await insert("INSERT INTO academic_years(name,start_date,end_date) VALUES('Concurrency year',CURRENT_DATE-1,CURRENT_DATE+30) RETURNING id",[])).id;
 const studentIds=[];
 for(let i=1;i<=3;i++){
  const user=(await insert("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,'test-hash','student') RETURNING id",[`Pupil ${i}`,`pupil${i}@example.test`])).id;
  studentIds.push((await insert('INSERT INTO students(user_id,admission_number,admission_date) VALUES($1,$2,CURRENT_DATE-1) RETURNING id',[user,`P${i}`])).id);
 }
 const vehicle=(await insert("INSERT INTO transport_vehicles(registration_number,capacity) VALUES('TEST-1',1) RETURNING id",[])).id;
 const routeA=(await insert('INSERT INTO transport_routes(name,vehicle_id) VALUES($1,$2) RETURNING id',['Route A',vehicle])).id;
 const routeB=(await insert('INSERT INTO transport_routes(name) VALUES($1) RETURNING id',['Route B'])).id;
 const stopA=(await insert('INSERT INTO transport_stops(route_id,name,sequence) VALUES($1,$2,1) RETURNING id',[routeA,'A'])).id;
 const stopB=(await insert('INSERT INTO transport_stops(route_id,name,sequence) VALUES($1,$2,1) RETURNING id',[routeB,'B'])).id;
 await testPool.query('INSERT INTO transport_allocations(student_id,stop_id,academic_year_id) VALUES($1,$2,$3)',[studentIds[0],stopB,year]);

 const operations=await Promise.allSettled([
  testPool.query('INSERT INTO transport_allocations(student_id,stop_id,academic_year_id) VALUES($1,$2,$3)',[studentIds[1],stopA,year]),
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
}finally{
 try{if(testPool)await testPool.end();}
 finally{if(adminConnected){try{if(schemaCreated)await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}finally{await admin.end();}}}
}
