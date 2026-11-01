import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='test-secret'.repeat(8);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');
const db=new PGlite();await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};
pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const password='StrongPassword!123',origin='http://localhost:5173';
await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)',['Admin','admin@example.com',await hashPassword(password),'admin']);
after(async()=>{await db.close();await pool.end();});
test('HTTP and SQL: roles, sessions, replay, password changes and logout',async()=>{
 const login=async(email='admin@example.com',pass=password)=>request(app).post('/api/auth/login').send({email,password:pass});
 let r=await request(app).get('/api/users');assert.equal(r.status,401);
 r=await login('admin@example.com','wrong');assert.equal(r.status,401);
 r=await login();assert.equal(r.status,200);let token=r.body.accessToken,cookie=r.headers['set-cookie'][0].split(';')[0];assert.match(r.headers['set-cookie'][0],/HttpOnly/);assert.equal(r.body.user.password_hash,undefined);
 for(const role of ['teacher','student','parent']){
 r=await request(app).post('/api/users').set('Authorization',`Bearer ${token}`).send({name:role,email:`${role}@example.com`,password,role});assert.equal(r.status,201);
 const id=r.body.user.id;
 r=await login(`${role}@example.com`);const other=r.body.accessToken;
 r=await request(app).get('/api/users').set('Authorization',`Bearer ${other}`);assert.equal(r.status,403);
 r=await request(app).post(`/api/users/${id}/reset-password`).set('Authorization',`Bearer ${token}`).send({newPassword:'ResetPassword!123'});assert.equal(r.status,204);
 r=await request(app).get('/api/auth/me').set('Authorization',`Bearer ${other}`);assert.equal(r.status,401);
 }
 r=await request(app).post('/api/users').set('Authorization',`Bearer ${token}`).send({name:'Dup',email:'teacher@example.com',password,role:'teacher'});assert.equal(r.status,409);
 r=await request(app).get('/api/users?limit=-1').set('Authorization',`Bearer ${token}`);assert.equal(r.status,400);
 r=await request(app).post('/api/auth/refresh').set('Cookie',cookie).set('Origin','https://evil.example');assert.equal(r.status,403);
 r=await request(app).post('/api/auth/refresh').set('Cookie',cookie).set('Origin',origin);assert.equal(r.status,200);let nextCookie=r.headers['set-cookie'][0].split(';')[0];
 r=await request(app).get('/api/auth/me').set('Authorization',`Bearer ${token}`);assert.equal(r.status,401);
 r=await request(app).post('/api/auth/refresh').set('Cookie',cookie).set('Origin',origin);assert.equal(r.status,401);
 r=await request(app).post('/api/auth/refresh').set('Cookie',nextCookie).set('Origin',origin);assert.equal(r.status,401);
 r=await login();token=r.body.accessToken;
 r=await request(app).post('/api/auth/change-password').set('Authorization',`Bearer ${token}`).send({currentPassword:password,newPassword:'ChangedPassword!123'});assert.equal(r.status,204);
 r=await request(app).get('/api/auth/me').set('Authorization',`Bearer ${token}`);assert.equal(r.status,401);
 r=await login('admin@example.com','ChangedPassword!123');assert.equal(r.status,200);token=r.body.accessToken;cookie=r.headers['set-cookie'][0].split(';')[0];
 r=await request(app).post('/api/auth/logout').set('Origin',origin).set('Cookie',cookie);assert.equal(r.status,204);
 r=await request(app).get('/api/auth/me').set('Authorization',`Bearer ${token}`);assert.equal(r.status,401);
});
test('strict validation and bcrypt byte limit',async()=>{
 const {createUser}=await import('../src/validators/auth.js');
 for(const changes of [{password:'🙂'.repeat(19)},{role:'superadmin'},{name:'<script>'},{extra:true}]) assert.equal(createUser.safeParse({name:'Valid',email:'a@example.com',password,role:'student',...changes}).success,false);
 const r=await request(app).post('/api/auth/login').set('Content-Type','application/json').send('{');assert.equal(r.status,400);
});
