import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='permissions-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const PW='StaffPassword!12345',hash=await hashPassword(PW);
const insert=async(sql,p)=>(await query(sql,p)).rows[0].id;
const schoolA=(await query("SELECT id FROM schools WHERE slug='existing-school'")).rows[0].id;
const schoolB=await insert("INSERT INTO schools(name,slug) VALUES('School B','school-b-perm') RETURNING id",[]);
const mk=async(email,role,school)=>{const id=await insert("INSERT INTO users(name,email,password_hash,role) VALUES($1,$1,$2,$3) RETURNING id",[email,hash,role]);await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[school,id,role]);return id;};
const admin=await mk('admin@example.com','admin',schoolA);await mk('adminb@example.com','admin',schoolB);
const ROLES=['principal','accountant','receptionist','librarian','transport_manager'];
for(const r of ROLES){await mk(`${r}@example.com`,r,schoolA);}
await mk('accountantb@example.com','accountant',schoolB);
const sUser=await insert("INSERT INTO users(name,email,password_hash,role) VALUES('Stu','stu@example.com',$1,'student') RETURNING id",[hash]);
const student=await insert("INSERT INTO students(user_id,admission_number,admission_date,school_id) VALUES($1,'A-1','2026-01-02',$2) RETURNING id",[sUser,schoolA]);
await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,'student','active',true)",[schoolA,sUser]);
after(async()=>{await db.close();await pool.end();});
const tokens={};
for(const email of ['admin','adminb','accountantb',...ROLES]){const r=await request(app).post('/api/auth/login').send({email:`${email}@example.com`,password:PW});assert.equal(r.status,200,email);tokens[email]=r.body;}
const as=(who)=>({get:p=>request(app).get('/api'+p).set('Authorization',`Bearer ${tokens[who].accessToken}`),post:(p,b={})=>request(app).post('/api'+p).set('Authorization',`Bearer ${tokens[who].accessToken}`).send(b),del:p=>request(app).delete('/api'+p).set('Authorization',`Bearer ${tokens[who].accessToken}`)});
const status=async(who,method,path,body)=>(await as(who)[method](path,body)).status;
test('new roles can sign in and carry their permissions',async()=>{
 for(const r of ROLES){assert.equal(tokens[r].user.role,r);assert.ok(tokens[r].user.permissions&&Object.keys(tokens[r].user.permissions).length>0,r);}
 assert.deepEqual(tokens.accountant.user.permissions.fees,['view','manage']);assert.deepEqual(tokens.librarian.user.permissions.students,['view']);assert.equal(tokens.librarian.user.permissions.fees,undefined);
 const created=await as('admin').post('/users',{name:'New Accountant',email:'newacc@example.com',password:'AnotherPassw0rd!',role:'accountant'});assert.equal(created.status,201,JSON.stringify(created.body));
 const l=await request(app).post('/api/auth/login').send({email:'newacc@example.com',password:'AnotherPassw0rd!'});assert.equal(l.status,200);assert.equal(l.body.user.role,'accountant');
 assert.equal(await status('accountant','get','/users'),403,'only admins manage users');assert.equal(await status('principal','post','/demo',{}),403);
});
test('principal: read-only school-wide view, manages notices and calendar only',async()=>{
 for(const p of ['/students','/teachers','/staff','/exams','/attendance/summary','/timetable/slots','/transport/vehicles','/fees/invoices','/dashboard'])assert.notEqual(await status('principal','get',p),403,p);
 assert.equal((await as('principal').get('/students')).body.items.length,1);
 assert.equal(await status('principal','post','/exams',{}),403);assert.equal(await status('principal','post','/fees/invoices',{}),403);assert.equal(await status('principal','del',`/students/${student}`),403);
 const n=await as('principal').post('/notices',{title:'Holiday',body:'School is closed',audience:'all',priority:'normal',available_from:new Date(Date.now()-60000).toISOString()});
 assert.equal(n.status,201,JSON.stringify(n.body));
 const pub=await as('principal').post(`/notices/${n.body.item.id}/publish`,{expected_version:n.body.item.version});assert.equal(pub.status,200,JSON.stringify(pub.body));
 assert.equal(await status('principal','post','/calendar',{}),400,'calendar write reaches validation (allowed)');
});
test('accountant manages fees, views students; nothing else',async()=>{
 assert.equal(await status('accountant','get','/fees/invoices'),200);assert.equal(await status('accountant','post','/fees/invoices',{}),400);
 assert.equal(await status('accountant','get','/students'),200);assert.equal(await status('accountant','post','/students',{}),403);
 for(const p of ['/transport/vehicles','/exams','/attendance/summary','/staff','/teachers','/dashboard'])assert.equal(await status('accountant','get',p),403,p);
});
test('receptionist manages students and parents but cannot delete, export or touch fees',async()=>{
 assert.equal(await status('receptionist','post','/students',{}),400);assert.equal(await status('receptionist','get','/students'),200);
 assert.equal(await status('receptionist','del',`/students/${student}`),403);assert.equal(await status('receptionist','get','/students/export.csv'),403);assert.equal(await status('receptionist','post','/students/promote',{}),403);
 assert.equal(await status('receptionist','get','/fees/invoices'),403);assert.equal(await status('receptionist','get','/transport/vehicles'),403);assert.equal(await status('receptionist','get','/notices'),200);
});
test('librarian is read-only on students and sees public notices and the calendar',async()=>{
 assert.equal(await status('librarian','get','/students'),200);assert.equal(await status('librarian','post','/students',{}),403);
 assert.equal(await status('librarian','get','/notices'),200);assert.equal(await status('librarian','post','/notices',{}),403);assert.equal(await status('librarian','get','/calendar'),200);
 for(const p of ['/fees/invoices','/transport/vehicles','/staff','/exams','/dashboard'])assert.equal(await status('librarian','get',p),403,p);
 const notes=await as('librarian').get('/notices');assert.ok(notes.body.items.some(n=>n.title==='Holiday'),'sees the published all-audience notice');
});
test('transport manager manages transport, views students and staff',async()=>{
 assert.equal(await status('transport_manager','get','/transport/vehicles'),200);assert.equal(await status('transport_manager','post','/transport/vehicles',{}),400);
 assert.equal(await status('transport_manager','get','/students'),200);assert.equal(await status('transport_manager','get','/staff'),200);assert.equal(await status('transport_manager','post','/staff',{}),403);
 for(const p of ['/fees/invoices','/exams','/dashboard'])assert.equal(await status('transport_manager','get',p),403,p);
});
test('staff roles stay inside their own school',async()=>{
 const own=await as('accountantb').get('/students');assert.equal(own.status,200);assert.equal(own.body.items.length,0);
 assert.equal((await as('accountantb').get(`/students/${student}`)).status,404);
 assert.equal((await as('accountantb').get('/fees/invoices')).body.items.length,0);
});
