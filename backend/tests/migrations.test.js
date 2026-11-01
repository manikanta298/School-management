import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
process.env.NODE_ENV='test';process.env.JWT_SECRET='migration-test-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');
test('real migration runner upgrades once and safely repeats',async()=>{
 const db=new PGlite();const originalEnd=pool.end.bind(pool);
 const query=async(text,params)=>{const r=params?await db.query(text,params):(await db.exec(text)).at(-1);return {...r,rowCount:r.rows.length||r.affectedRows||0};};
 pool.connect=async()=>({query,release(){}});pool.end=async()=>{};
 try{
  await import('../database/migrate.js?first');
  await query("INSERT INTO academic_years(name,start_date,end_date) VALUES($1,$2,$3)",['Persisted year','2026-01-01','2026-12-31']);
  await import('../database/migrate.js?repeat');
  const migrations=await query('SELECT name FROM schema_migrations ORDER BY name');assert.deepEqual(migrations.rows.map(r=>r.name),['001_auth.sql','002_academic.sql','003_students_parents.sql','004_teachers.sql','005_attendance.sql']);
  const data=await query('SELECT name FROM academic_years');assert.equal(data.rows[0].name,'Persisted year');
 }finally{await db.close();await originalEnd();}
});
