import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='tenant-isolation-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const PW='TenantPassword!123',hash=await hashPassword(PW),tokens={},ids={};
const insert=async(sql,p)=>(await query(sql,p)).rows[0].id;
const schoolA=(await query("SELECT id FROM schools WHERE slug='existing-school'")).rows[0].id;
const schoolB=await insert("INSERT INTO schools(name,slug) VALUES('School B','school-b-iso') RETURNING id");
for(const [key,school] of [['adminA',schoolA],['adminB',schoolB]]){
 const uid=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key.toLowerCase()}@example.com`,hash,'admin']);
 await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,'admin','active',true)",[school,uid]);
 const r=await request(app).post('/api/auth/login').send({email:`${key.toLowerCase()}@example.com`,password:PW});assert.equal(r.status,200);tokens[key]=r.body.accessToken;
}
// School A records (explicit school_id everywhere)
const year=await insert("INSERT INTO academic_years(name,start_date,end_date,is_current,school_id) VALUES('Y','2026-01-01','2026-12-31',true,$1) RETURNING id",[schoolA]);
const sUser=await insert("INSERT INTO users(name,email,password_hash,role) VALUES('Stu','stu@example.com',$1,'student') RETURNING id",[hash]);
ids.student=await insert("INSERT INTO students(user_id,admission_number,admission_date,school_id) VALUES($1,'A-1','2026-01-02',$2) RETURNING id",[sUser,schoolA]);
const tUser=await insert("INSERT INTO users(name,email,password_hash,role) VALUES('Tea','tea@example.com',$1,'teacher') RETURNING id",[hash]);
ids.teacher=await insert("INSERT INTO teachers(user_id,employee_number,joining_date,school_id) VALUES($1,'T-1','2025-01-01',$2) RETURNING id",[tUser,schoolA]);
ids.staff=await insert("INSERT INTO staff_members(school_id,employee_number,name,staff_type,joining_date) VALUES($1,'S-1','Clerk','clerk','2025-01-01') RETURNING id",[schoolA]).catch(()=>null);
const call=(path,who)=>request(app).get('/api'+path).set('Authorization',`Bearer ${tokens[who]}`);
after(async()=>{await db.close();await pool.end();});
test('school A sees its own records (control)',async()=>{
 let r=await call('/students','adminA');assert.equal(r.status,200);assert.equal(r.body.items.length,1);
 r=await call('/teachers','adminA');assert.equal(r.status,200);assert.equal(r.body.items.length,1);
});
test('school B admin cannot list or open school A people, staff, classes or transport',async()=>{
 for(const path of ['/students','/teachers','/staff','/academic/years','/transport/vehicles','/transport/routes','/transport/allocations']){
  const r=await call(path,'adminB');
  if(r.status===404)continue;
  assert.equal(r.status,200,`${path} ${JSON.stringify(r.body)}`);
  const items=r.body.items??r.body.years??r.body.data;if(Array.isArray(items))assert.equal(items.length,0,path);
 }
 let r=await call(`/students/${ids.student}`,'adminB');assert.equal(r.status,404);
 r=await call(`/students/${ids.student}/parents`,'adminB');assert.ok([403,404].includes(r.status),String(r.status));
 r=await call(`/teachers/${ids.teacher}`,'adminB');assert.equal(r.status,404);
 if(ids.staff){r=await call(`/staff/${ids.staff}`,'adminB');assert.equal(r.status,404);}
 r=await call('/students/export.csv','adminB');assert.equal(r.status,200);assert.ok(!r.text.includes('A-1'));
});
