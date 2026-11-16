import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='calendar-test-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const schoolA=(await query("SELECT id FROM schools WHERE slug='existing-school'")).rows[0].id;
// Fixtures default to the initial school; second-school rows pass school_id explicitly.
for(const {table_name} of (await query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='school_id' AND table_name NOT IN ('school_memberships')")).rows)await query(`ALTER TABLE ${table_name} ALTER COLUMN school_id SET DEFAULT '${schoolA}'`);
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const hash=await hashPassword('CalendarPassword!123'),tokens={};
for(const role of ['admin','teacher','student','parent']){
 const uid=(await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[role,`${role}@example.com`,hash,role])).rows[0].id;await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolA,uid,role]);
 const login=await request(app).post('/api/auth/login').send({email:`${role}@example.com`,password:'CalendarPassword!123'});assert.equal(login.status,200);tokens[role]=login.body.accessToken;
}
const call=(method,path,body,who='admin')=>{const req=request(app)[method]('/api/'+path).set('Authorization',`Bearer ${tokens[who]}`);return body?req.send(body):req;};
const day=offset=>{const d=new Date();d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
after(async()=>{await db.close();await pool.end();});
test('everyone reads the calendar but only admins change it',async()=>{
 let r=await request(app).get('/api/calendar');assert.equal(r.status,401);
 r=await call('post','calendar',{title:'Diwali break',event_type:'holiday',starts_on:day(5),ends_on:day(9),description:'School closed'});assert.equal(r.status,201);const id=r.body.item.id;assert.equal(r.body.item.starts_on,day(5));assert.equal(r.body.item.ends_on,day(9));
 r=await call('post','calendar',{title:'Sports day',event_type:'event',starts_on:day(20)});assert.equal(r.status,201);assert.equal(r.body.item.ends_on,day(20));
 await call('post','calendar',{title:'Old event',event_type:'event',starts_on:day(-30),ends_on:day(-20)});
 for(const who of ['teacher','student','parent']){r=await call('post','calendar',{title:'No',event_type:'event',starts_on:day(1)},who);assert.equal(r.status,403);r=await call('put',`calendar/${id}`,{title:'No',event_type:'event',starts_on:day(1)},who);assert.equal(r.status,403);r=await call('delete',`calendar/${id}`,undefined,who);assert.equal(r.status,403);r=await call('get','calendar',undefined,who);assert.equal(r.status,200);assert.equal(r.body.items.length,2);}
 r=await call('get',`calendar?from=${day(-40)}&to=${day(-1)}`);assert.deepEqual(r.body.items.map(e=>e.title),['Old event']);
 r=await call('get',`calendar?from=${day(7)}&to=${day(7)}`);assert.deepEqual(r.body.items.map(e=>e.title),['Diwali break']);
 r=await call('get','calendar?event_type=event');assert.deepEqual(r.body.items.map(e=>e.title),['Sports day']);
 r=await call('get','calendar?limit=1');assert.equal(r.body.items.length,1);
 for(const bad of ['limit=0','event_type=party','from=2024-02-30',`from=${day(5)}&to=${day(1)}`,'extra=1']){r=await call('get',`calendar?${bad}`);assert.equal(r.status,400);}
 r=await call('put',`calendar/${id}`,{title:'Diwali holidays',event_type:'holiday',starts_on:day(5),ends_on:day(10)});assert.equal(r.status,200);assert.equal(r.body.item.title,'Diwali holidays');
 for(const bad of [{ends_on:day(1)},{title:'<b>'},{event_type:'party'},{starts_on:'nope'},{extra:1},{title:''}]){r=await call('put',`calendar/${id}`,{title:'T',event_type:'event',starts_on:day(5),...bad});assert.equal(r.status,400);}
 r=await call('put','calendar/00000000-0000-4000-8000-000000000999',{title:'T',event_type:'event',starts_on:day(5)});assert.equal(r.status,404);
 r=await call('delete',`calendar/${id}`);assert.equal(r.status,204);r=await call('delete',`calendar/${id}`);assert.equal(r.status,404);
 r=await call('get','calendar/not-a-uuid');assert.equal(r.status,404);
});
test('calendar events are isolated between schools',async()=>{
 const {rows:[sb]}=await query("INSERT INTO schools(name,slug) VALUES('School B','school-b') RETURNING id");const schoolB=sb.id;
 for(const [name,role] of [['adminb','admin'],['studentb','student']]){const id=(await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[name,`${name}@example.com`,hash,role])).rows[0].id;await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolB,id,role]);const r=await request(app).post('/api/auth/login').send({email:`${name}@example.com`,password:'CalendarPassword!123'});assert.equal(r.status,200);tokens[name]=r.body.accessToken;}
 let r=await call('post','calendar',{title:'Isolation holiday',event_type:'holiday',starts_on:day(40),ends_on:day(41)});assert.equal(r.status,201);const idA=r.body.item.id;
 // School B sees none of School A's events and cannot change or delete them.
 for(const who of ['adminb','studentb']){r=await call('get',`calendar?from=${day(39)}&to=${day(42)}`,undefined,who);assert.equal(r.status,200);assert.deepEqual(r.body.items,[],who);}
 r=await call('put',`calendar/${idA}`,{title:'Hijack',event_type:'event',starts_on:day(40)},'adminb');assert.equal(r.status,404);
 r=await call('delete',`calendar/${idA}`,undefined,'adminb');assert.equal(r.status,404);
 // School B keeps its own calendar.
 r=await call('post','calendar',{title:'Isolation holiday',event_type:'holiday',starts_on:day(40),ends_on:day(41)},'adminb');assert.equal(r.status,201);const idB=r.body.item.id;
 r=await call('get',`calendar?from=${day(39)}&to=${day(42)}`,undefined,'studentb');assert.deepEqual(r.body.items.map(i=>i.id),[idB]);
 r=await call('get',`calendar?from=${day(39)}&to=${day(42)}`);assert.deepEqual(r.body.items.map(i=>i.id),[idA]);
 r=await call('put',`calendar/${idB}`,{title:'Hijack',event_type:'event',starts_on:day(40)});assert.equal(r.status,404);
 r=await call('delete',`calendar/${idB}`);assert.equal(r.status,404);
 r=await call('delete',`calendar/${idB}`,undefined,'adminb');assert.equal(r.status,204);
 r=await call('get',`calendar?from=${day(39)}&to=${day(42)}`);assert.deepEqual(r.body.items.map(i=>i.id),[idA]);
});
