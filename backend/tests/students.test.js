import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
import pg from 'pg';
process.env.NODE_ENV='test';process.env.JWT_SECRET='students-test-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const password='StudentsPassword!123',hash=await hashPassword(password),accounts={},tokens={},ids={};
for(const [key,role] of [['admin','admin'],['teacher','teacher'],['s1','student'],['s2','student'],['s3','student'],['p1','parent'],['p2','parent'],['outsider','parent']]){
 const r=await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key}@example.com`,hash,role]);accounts[key]=r.rows[0].id;
 const login=await request(app).post('/api/auth/login').send({email:`${key}@example.com`,password});assert.equal(login.status,200);tokens[key]=login.body.accessToken;
}
const call=(method,path,body,who='admin')=>{let req=request(app)[method]('/api/'+path).set('Authorization',`Bearer ${tokens[who]}`);return body?req.send(body):req;};
const studentBody=key=>({user_id:accounts[key],admission_number:`ADM-${key}`,admission_date:'2025-01-01',date_of_birth:'2015-01-01',address:'School road'});
after(async()=>{await db.close();await pool.end();});
test('profile CRUD and family scoping prevent cross-family access',async()=>{
 let r=await request(app).get('/api/students');assert.equal(r.status,401);
 r=await call('post','students',studentBody('p1'));assert.equal(r.status,409);
 for(const key of ['s1','s2','s3']){r=await call('post','students',studentBody(key));assert.equal(r.status,201);ids[key]=r.body.item.id;assert.equal(r.body.item.password_hash,undefined);assert.equal(r.body.item.account_role,undefined);}
 for(const key of ['p1','p2','outsider']){r=await call('post','parents',{user_id:accounts[key],phone:'+91 98765 43210',address:'Parent address'});assert.equal(r.status,201);ids[key]=r.body.item.id;}
 r=await call('post','students',studentBody('s1'));assert.equal(r.status,409);
 r=await call('put',`students/${ids.s1}`,{...studentBody('s1'),admission_number:'OTHER'});assert.equal(r.status,400); // account association is immutable
 const {user_id,...body}=studentBody('s1');
 r=await call('put',`students/${ids.s1}`,{...body,address:'Updated address'});assert.equal(r.status,200);assert.equal(r.body.item.address,'Updated address');
 r=await call('put',`parents/${ids.p1}`,{phone:'+1 555 123 4567',address:null});assert.equal(r.status,200);
 for(const [s,p] of [['s1','p1'],['s1','p2'],['s2','p1'],['s2','p2']]){r=await call('post',`students/${ids[s]}/parents`,{parent_id:ids[p],relationship:'guardian'});assert.equal(r.status,201);}
 r=await call('post',`students/${ids.s1}/parents`,{parent_id:ids.p1,relationship:'mother'});assert.equal(r.status,409);
 r=await call('get','students',undefined,'p1');assert.equal(r.body.items.length,2);
 r=await call('get','students',undefined,'outsider');assert.equal(r.body.items.length,0);
 r=await call('get','students',undefined,'s1');assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].id,ids.s1);
 for(const [who,id] of [['p1',ids.s3],['outsider',ids.s1],['s1',ids.s2]]){
  for(const suffix of ['', '/enrollments','/parents']){r=await call('get',`students/${id}${suffix}`,undefined,who);assert.equal(r.status,404);}
 }
 r=await call('get',`students/${ids.s1}/parents`,undefined,'p1');assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].parent_id,ids.p1);assert.equal(r.body.items[0].phone,undefined);assert.equal(r.body.items[0].email,undefined);
 r=await call('get',`students/${ids.s1}/parents`,undefined,'s1');assert.equal(r.body.items.length,2);
 r=await call('get','parents',undefined,'p1');assert.equal(r.body.items.length,1);
 r=await call('get',`parents/${ids.p2}`,undefined,'p1');assert.equal(r.status,404);
 r=await call('get','parents',undefined,'s1');assert.equal(r.status,403);
 for(const path of ['students','parents',`students/${ids.s1}`]){r=await call('get',path,undefined,'teacher');assert.equal(r.status,403);}
 for(const who of ['p1','s1']){
  r=await call('put',`students/${ids.s1}`,body,who);assert.equal(r.status,403);
  r=await call('post',`students/${ids.s1}/parents`,{parent_id:ids.p1,relationship:'other'},who);assert.equal(r.status,403);
  r=await call('delete',`students/${ids.s1}`,undefined,who);assert.equal(r.status,403);
 }
 r=await call('get','students?q=ADM-S1&limit=1');assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].id,ids.s1);
 r=await call('get',`students?parent_id=${ids.p1}`,undefined,'outsider');assert.equal(r.body.items.length,0);
 r=await call('get',"students?q=%27%20OR%201%3D1--");assert.equal(r.body.items.length,0);
 r=await call('delete',`parents/${ids.p1}`);assert.equal(r.status,409);
 r=await call('delete',`students/${ids.s2}/parents/${ids.p1}`);assert.equal(r.status,204);
 r=await call('get',`students/${ids.s2}`,undefined,'p1');assert.equal(r.status,404);
 r=await call('delete',`students/${ids.s2}/parents/${ids.p1}`);assert.equal(r.status,404);
});
test('enrollment integrity, seat capacity, transfers and retention',async()=>{
 let r=await call('post','academic/academic-years',{name:'Year One',start_date:'2025-06-01',end_date:'2026-05-31'});assert.equal(r.status,201);ids.y1=r.body.item.id;
 r=await call('post','academic/academic-years',{name:'Year Two',start_date:'2026-06-01',end_date:'2027-05-31'});ids.y2=r.body.item.id;
 for(const key of ['y1','y2']){r=await call('post','academic/classes',{name:'Grade 1',academic_year_id:ids[key]});ids[key+'class']=r.body.item.id;}
 for(const [key,cl,capacity] of [['a','y1class',1],['b','y1class',2],['c','y2class',1]]){r=await call('post','academic/sections',{name:key,class_id:ids[cl],capacity});assert.equal(r.status,201);ids[key]=r.body.item.id;}
 const enroll=(section,status='active')=>({academic_year_id:ids.y1,section_id:ids[section],enrolled_on:'2025-06-01',status});
 r=await call('post',`students/${ids.s1}/enrollments`,enroll('a'));assert.equal(r.status,201);ids.e1=r.body.item.id;
 r=await call('post',`students/${ids.s1}/enrollments`,enroll('b'));assert.equal(r.status,409);
 r=await call('post',`students/${ids.s2}/enrollments`,enroll('a'));assert.equal(r.status,400);
 r=await call('post',`students/${ids.s2}/enrollments`,enroll('a','withdrawn'));assert.equal(r.status,201);ids.e2=r.body.item.id;
 r=await call('put',`students/${ids.s1}/enrollments/${ids.e1}`,enroll('a'));assert.equal(r.status,200);
 r=await call('put',`students/${ids.s1}/enrollments/${ids.e1}`,enroll('b'));assert.equal(r.status,200);
 r=await call('post',`students/${ids.s3}/enrollments`,enroll('a'));assert.equal(r.status,201);ids.e3=r.body.item.id;
 r=await call('put',`students/${ids.s2}/enrollments/${ids.e2}`,enroll('b'));assert.equal(r.status,200);
 r=await call('put',`academic/sections/${ids.b}`,{name:'b',class_id:ids.y1class,capacity:1});assert.equal(r.status,400);
 r=await call('put',`students/${ids.s2}/enrollments/${ids.e2}`,enroll('b','completed'));assert.equal(r.status,200);
 r=await call('put',`academic/sections/${ids.b}`,{name:'b',class_id:ids.y1class,capacity:1});assert.equal(r.status,200);
 r=await call('put',`students/${ids.s2}/enrollments/${ids.e2}`,enroll('b'));assert.equal(r.status,400);
 r=await call('put',`students/${ids.s3}/enrollments/${ids.e3}`,{...enroll('a'),academic_year_id:ids.y2,enrolled_on:'2026-06-01'});assert.equal(r.status,409);
 r=await call('put',`students/${ids.s3}/enrollments/${ids.e3}`,{...enroll('a'),enrolled_on:'2025-05-31'});assert.equal(r.status,400);
 const {user_id,...profile}=studentBody('s3');
 r=await call('put',`students/${ids.s3}`,{...profile,admission_date:'2025-08-01'});assert.equal(r.status,400);
 r=await call('put',`academic/academic-years/${ids.y1}`,{name:'Year One',start_date:'2025-07-01',end_date:'2026-05-31'});assert.equal(r.status,400);
 r=await call('put',`academic/classes/${ids.y1class}`,{name:'Grade 1',academic_year_id:ids.y2});assert.equal(r.status,409);
 r=await call('put',`academic/sections/${ids.a}`,{name:'a',class_id:ids.y2class,capacity:1});assert.equal(r.status,409);
 r=await call('get',`students?section_id=${ids.b}`);assert.equal(r.body.items.length,2);
 r=await call('get',`students/${ids.s1}/enrollments`,undefined,'s1');assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].section_id,ids.b);
 r=await call('get',`students/${ids.s1}/enrollments`,undefined,'p1');assert.equal(r.body.items.length,1);
 r=await call('post',`students/${ids.s1}/enrollments`,enroll('a'),'p1');assert.equal(r.status,403);
 r=await call('delete',`students/${ids.s3}`);assert.equal(r.status,409);
 r=await call('delete',`students/${ids.s3}/enrollments/${ids.e1}`);assert.equal(r.status,404);
 r=await call('delete',`students/${ids.s3}/enrollments/${ids.e3}`);assert.equal(r.status,204);
 r=await call('delete',`students/${ids.s3}`);assert.equal(r.status,204);
 r=await query('SELECT 1 FROM users WHERE id=$1',[accounts.s3]);assert.equal(r.rowCount,1);
});
test('input and database constraints reject malformed profiles and associations',async()=>{
 for(const path of ['students/not-a-uuid','students?limit=0','parents?offset=-1']){const r=await call('get',path);assert.equal(r.status,400);}
 const r=await call('post','students',{...studentBody('s3'),date_of_birth:'2025-02-30'});assert.equal(r.status,400);
 await assert.rejects(query('UPDATE users SET role=$1 WHERE id=$2',['parent',accounts.s1]),e=>e.code==='23503');
 await assert.rejects(query('UPDATE sections SET capacity=$1 WHERE id=$2',[0,ids.b]),e=>e.code==='23514');
 await assert.rejects(query('UPDATE students SET date_of_birth=$1 WHERE id=$2',['2030-01-01',ids.s1]),e=>e.code==='23514');
});

test('PostgreSQL calendar dates keep their day across server timezones',()=>{assert.equal(pg.types.getTypeParser(1082)('2025-06-01'),'2025-06-01');});
