import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='student-promotion-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;
pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const PW='PromotionPassword!123',hash=await hashPassword(PW),tokens={},ids={};
const insert=async(sql,p)=>(await query(sql,p)).rows[0].id;
const schoolA=(await query("SELECT id FROM schools WHERE slug='existing-school'")).rows[0].id;
const schoolB=await insert("INSERT INTO schools(name,slug) VALUES('School B','school-b-promo') RETURNING id");
for(const [key,school] of [['admina',schoolA],['adminb',schoolB]]){
 const uid=await insert("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id",[key,`${key}@example.com`,hash]);
 await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,'admin','active',true)",[school,uid]);
 const r=await request(app).post('/api/auth/login').send({email:`${key}@example.com`,password:PW});assert.equal(r.status,200);tokens[key]=r.body.accessToken;
}
const year=(name,s,e,cur,school=schoolA)=>insert('INSERT INTO academic_years(name,start_date,end_date,is_current,school_id) VALUES($1,$2,$3,$4,$5) RETURNING id',[name,s,e,cur,school]);
ids.y1=await year('2025-26','2025-06-01','2026-05-31',true);ids.y2=await year('2026-27','2026-06-01','2027-05-31',false);
ids.yB=await year('B-year','2026-06-01','2027-05-31',true,schoolB);
const cls=(name,y,school=schoolA)=>insert('INSERT INTO classes(name,academic_year_id,school_id) VALUES($1,$2,$3) RETURNING id',[name,y,school]);
const sec=(name,c,cap,school=schoolA)=>insert('INSERT INTO sections(name,class_id,capacity,school_id) VALUES($1,$2,$3,$4) RETURNING id',[name,c,cap,school]);
ids.c1=await cls('Class 1',ids.y1);ids.c2=await cls('Class 2',ids.y2);ids.cB=await cls('B class',ids.yB,schoolB);
ids.s1=await sec('A',ids.c1,40);ids.s2=await sec('A',ids.c2,1);ids.sB=await sec('A',ids.cB,40,schoolB);
for(const n of ['one','two','three']){
 const u=await insert("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'student') RETURNING id",[n,`${n}@example.com`,hash]);
 ids[n]=await insert("INSERT INTO students(user_id,admission_number,admission_date,school_id) VALUES($1,$2,'2025-05-01',$3) RETURNING id",[u,`ADM-${n.toUpperCase()}`,schoolA]);
 await query("INSERT INTO enrollments(school_id,student_id,academic_year_id,class_id,section_id,enrolled_on,status) VALUES($1,$2,$3,$4,$5,'2025-06-02','active')",[schoolA,ids[n],ids.y1,ids.c1,ids.s1]);
}
after(async()=>{await db.close();await pool.end();});
const promote=(body,who='admina')=>request(app).post('/api/students/promote').set('Authorization',`Bearer ${tokens[who]}`).send(body);
const enr=async(student)=>(await query('SELECT academic_year_id,status FROM enrollments WHERE student_id=$1 ORDER BY enrolled_on,created_at',[student])).rows;
test('promotion previews by default and validates every row',async()=>{
 let r=await promote({to_academic_year_id:ids.y2,moves:[{student_id:ids.one,section_id:ids.s2}]});
 assert.equal(r.status,200);assert.equal(r.body.valid,true);assert.equal(r.body.applied,false);assert.equal((await enr(ids.one)).length,1);
 r=await request(app).post('/api/students/promote').send({to_academic_year_id:ids.y2,moves:[]});assert.equal(r.status,401);
 r=await promote({to_academic_year_id:'bad',moves:[{student_id:ids.one,section_id:ids.s2}]});assert.equal(r.status,400);
 r=await promote({to_academic_year_id:ids.y2,moves:[{student_id:ids.one,section_id:ids.s1}]});assert.equal(r.body.valid,false);assert.match(r.body.results[0].errors.join(),/target academic year/);
 r=await promote({to_academic_year_id:ids.y2,moves:[{student_id:ids.one,section_id:ids.sB}]});assert.equal(r.body.valid,false);assert.match(r.body.results[0].errors.join(),/section not found/);
 r=await promote({to_academic_year_id:ids.y2,moves:[{student_id:ids.one,section_id:ids.s2},{student_id:ids.one,section_id:ids.s2}]});assert.equal(r.body.valid,false);assert.match(r.body.results[1].errors.join(),/more than once/);
 r=await promote({to_academic_year_id:ids.yB,moves:[{student_id:ids.one,section_id:ids.sB}]});assert.equal(r.status,404);
});
test('a failing row rolls the whole promotion back; a valid run completes old enrollments',async()=>{
 let r=await promote({dry_run:false,to_academic_year_id:ids.y2,moves:[{student_id:ids.one,section_id:ids.s2},{student_id:ids.two,section_id:ids.s2}]});
 assert.equal(r.status,409,JSON.stringify(r.body));
 for(const s of [ids.one,ids.two]){const e=await enr(s);assert.equal(e.length,1);assert.equal(e[0].status,'active');}
 r=await promote({dry_run:false,to_academic_year_id:ids.y2,moves:[{student_id:ids.one,section_id:ids.s2}]});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.applied,true);
 const e=await enr(ids.one);assert.deepEqual(e.map(x=>[x.academic_year_id,x.status]),[[ids.y1,'completed'],[ids.y2,'active']]);
 r=await promote({to_academic_year_id:ids.y2,moves:[{student_id:ids.one,section_id:ids.s2}]});assert.equal(r.body.valid,false);assert.match(r.body.results[0].errors.join(),/already enrolled/);
 r=await promote({to_academic_year_id:ids.y2,moves:[{student_id:ids.one,section_id:ids.s2}]},'adminb');assert.equal(r.status,404);
 await query("UPDATE students SET lifecycle_status='inactive' WHERE id=$1",[ids.three]);
 r=await promote({to_academic_year_id:ids.y2,moves:[{student_id:ids.three,section_id:ids.s2}]});assert.match(r.body.results[0].errors.join(),/only active students/);
});
