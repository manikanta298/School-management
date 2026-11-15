import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='academic-test-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const password='AcademicPassword!123';const hash=await hashPassword(password);
const schoolA=(await query(\"SELECT id FROM schools WHERE slug='existing-school'\")).rows[0].id;
for(const role of ['admin','teacher','student','parent']){const user=(await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[role,`${role}@example.com`,hash,role])).rows[0].id;await query(\"INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)\",[schoolA,user,role]);}
after(async()=>{await db.close();await pool.end();});
test('academic CRUD, role access, constraints, filters and pagination',async()=>{
 let r=await request(app).get('/api/academic/classes');assert.equal(r.status,401);
 const login=await request(app).post('/api/auth/login').send({email:'admin@example.com',password});assert.equal(login.status,200);const token=login.body.accessToken;
 const call=(method,path,body)=>{let req=request(app)[method]('/api/academic/'+path).set('Authorization',`Bearer ${token}`);return body?req.send(body):req;};
 const year={name:'2026–2027',start_date:'2026-06-01',end_date:'2027-05-31',is_current:true};
 r=await call('post','academic-years',year);assert.equal(r.status,201);const y=r.body.item.id;
 r=await call('post','academic-years',{...year,name:'Other'});assert.equal(r.status,409);
 r=await call('post','academic-years',{...year,name:'Old',is_current:false});assert.equal(r.status,201);const old=r.body.item.id;
 r=await call('post','terms',{name:'Term 1',academic_year_id:y,start_date:'2026-06-01',end_date:'2026-09-30'});assert.equal(r.status,201);const term=r.body.item.id;
 r=await call('post','terms',{name:'Overlap',academic_year_id:y,start_date:'2026-09-30',end_date:'2026-12-30'});assert.equal(r.status,400);
 r=await call('post','terms',{name:'Outside',academic_year_id:y,start_date:'2025-01-01',end_date:'2025-02-01'});assert.equal(r.status,400);
 r=await call('put',`academic-years/${y}`,{...year,start_date:'2026-07-01'});assert.equal(r.status,400);
 r=await call('post','academic-years',{...year,name:'Bad date',start_date:'2026-02-30',is_current:false});assert.equal(r.status,400);
 r=await call('post','classes',{name:'Grade 1',academic_year_id:y});assert.equal(r.status,201);const cl=r.body.item.id;
 r=await call('post','classes',{name:'grade 1',academic_year_id:y});assert.equal(r.status,409);
 r=await call('post','classes',{name:'Grade 1',academic_year_id:old});assert.equal(r.status,201);const oldClass=r.body.item.id;
 r=await call('get',`classes?academic_year_id=${y}&limit=1&offset=0`);assert.equal(r.status,200);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].id,cl);
 r=await call('post','sections',{name:'A',class_id:cl,capacity:30});assert.equal(r.status,201);const section=r.body.item.id;
 r=await call('put',`sections/${section}`,{name:'B',class_id:cl,capacity:35});assert.equal(r.status,200);assert.equal(r.body.item.capacity,35);
 r=await call('post','sections',{name:'Bad',class_id:cl,capacity:0});assert.equal(r.status,400);
 r=await call('post','subjects',{name:'Mathematics',code:' math '});assert.equal(r.status,201);const subject=r.body.item.id;assert.equal(r.body.item.code,'MATH');
 r=await call('post','subjects',{name:'Other math',code:'MATH'});assert.equal(r.status,409);
 for(const role of ['teacher','student','parent']){
  const logged=await request(app).post('/api/auth/login').send({email:`${role}@example.com`,password});const t=logged.body.accessToken;
  r=await request(app).get('/api/academic/classes').set('Authorization',`Bearer ${t}`);assert.equal(r.status,200);
  for(const [method,path] of [['post','subjects'],['put',`subjects/${subject}`],['delete',`subjects/${subject}`]]){r=await request(app)[method]('/api/academic/'+path).set('Authorization',`Bearer ${t}`).send({name:'Hacked',code:'BAD'});assert.equal(r.status,403);}
 }
 r=await call('delete',`academic-years/${y}`);assert.equal(r.status,409);
 r=await call('delete',`classes/${cl}`);assert.equal(r.status,409);
 r=await call('get','constructor');assert.equal(r.status,404);
 r=await call('get','classes/not-a-uuid');assert.equal(r.status,400);
 r=await call('get','classes?limit=101');assert.equal(r.status,400);
 r=await call('post','classes',{name:'Unknown year',academic_year_id:'00000000-0000-4000-8000-000000000000'});assert.equal(r.status,409);
 r=await call('post','subjects',{name:'<script>',code:'X'});assert.equal(r.status,400);
 for(const path of [`sections/${section}`,`terms/${term}`,`classes/${cl}`,`classes/${oldClass}`,`subjects/${subject}`,`academic-years/${y}`,`academic-years/${old}`]){r=await call('delete',path);assert.equal(r.status,204);}
 r=await call('get',`academic-years/${y}`);assert.equal(r.status,404);
 r=await call('put',`academic-years/${y}`,year);assert.equal(r.status,404);
});

test('academic catalogue is isolated and parent references cannot cross schools',async()=>{
 const schoolB=(await query("INSERT INTO schools(name,slug) VALUES('Second School','second-school') RETURNING id")).rows[0].id;
 const userB=(await query("INSERT INTO users(name,email,password_hash,role) VALUES('Second Admin','second-admin@example.com',$1,'admin') RETURNING id",[hash])).rows[0].id;
 await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,'admin','active',true)",[schoolB,userB]);
 const loginB=await request(app).post('/api/auth/login').send({email:'second-admin@example.com',password});assert.equal(loginB.status,200);const tokenB=loginB.body.accessToken;
 const callB=(method,path,body)=>{const req=request(app)[method]('/api/academic/'+path).set('Authorization',`Bearer ${tokenB}`);return body?req.send(body):req;};
 let r=await callB('get','academic-years');assert.equal(r.status,200);assert.equal(r.body.items.length,0);
 r=await callB('post','academic-years',{name:'2026–2027',start_date:'2026-06-01',end_date:'2027-05-31',is_current:true});assert.equal(r.status,201);const yearB=r.body.item.id;
 r=await callB('post','classes',{name:'Grade 1',academic_year_id:'00000000-0000-4000-8000-000000000000'});assert.equal(r.status,409);
 const yearA=(await query("SELECT id FROM academic_years WHERE school_id=$1 LIMIT 1",[schoolA])).rows[0].id;
 r=await callB('post','classes',{name:'Hijack',academic_year_id:yearA});assert.equal(r.status,409,'school B cannot reference school A academic year');
 r=await callB('get',`academic-years/${yearA}`);assert.equal(r.status,404);
 r=await callB('put',`academic-years/${yearA}`,{name:'Changed',start_date:'2026-06-01',end_date:'2027-05-31',is_current:false});assert.equal(r.status,404);
 const schoolBClasses=await callB('post','classes',{name:'Grade 1',academic_year_id:yearB});assert.equal(schoolBClasses.status,201);
 const schoolBSubject=await callB('post','subjects',{name:'Mathematics',code:'MATH'});assert.equal(schoolBSubject.status,201,'same subject code can exist in separate schools');
 const schoolASubject=await call('post','subjects',{name:'Mathematics',code:'MATH'});assert.equal(schoolASubject.status,201);
 const aList=await call('get','academic-years');assert.equal(aList.body.items.length,2);
 const bList=await callB('get','academic-years');assert.equal(bList.body.items.length,1);
});
