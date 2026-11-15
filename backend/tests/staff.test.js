import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='staff-test-secret'.repeat(5);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const password='StaffPassword!123',hash=await hashPassword(password),tokens={};
const schoolA=(await query("SELECT id FROM schools WHERE slug='existing-school'")).rows[0].id;
for(const role of ['admin','teacher','student','parent']){
 const user=(await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[role,`${role}@example.com`,hash,role])).rows[0].id;
 await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolA,user,role]);
 const login=await request(app).post('/api/auth/login').send({email:`${role}@example.com`,password});assert.equal(login.status,200);tokens[role]=login.body.accessToken;
}
const call=(method,path,body,who='admin')=>{const req=request(app)[method]('/api/'+path).set('Authorization',`Bearer ${tokens[who]}`);return body?req.send(body):req;};
const staff=(n,extra={})=>({employee_number:`st-${n}`,name:`Staff ${n}`,staff_type:'accountant',joining_date:'2024-04-01',...extra});
after(async()=>{await db.close();await pool.end();});
test('only administrators manage staff and records validate strictly',async()=>{
 let r=await request(app).get('/api/staff');assert.equal(r.status,401);
 for(const who of ['teacher','student','parent']){r=await call('get','staff',undefined,who);assert.equal(r.status,403);r=await call('post','staff',staff(0),who);assert.equal(r.status,403);}
 r=await call('post','staff',staff(1,{phone:'+91 98765 43210',email:'Staff1@Example.com',address:'School road'}));assert.equal(r.status,201);
 const id=r.body.item.id;assert.equal(r.body.item.employee_number,'ST-1');assert.equal(r.body.item.email,'staff1@example.com');assert.equal(r.body.item.employment_status,'active');assert.equal(r.body.item.joining_date,'2024-04-01');
 r=await call('post','staff',staff(1));assert.equal(r.status,409);
 for(const bad of [{staff_type:'principal'},{joining_date:'2024-02-30'},{joining_date:'2999-01-01'},{phone:'abc'},{email:'not-an-email'},{name:'<b>x</b>'},{unknown:1},{employee_number:'bad number'}]){r=await call('post','staff',staff(2,bad));assert.equal(r.status,400);}
 r=await call('put',`staff/${id}`,staff(1,{staff_type:'librarian',employment_status:'inactive'}));assert.equal(r.status,200);assert.equal(r.body.item.staff_type,'librarian');assert.equal(r.body.item.employment_status,'inactive');assert.equal(r.body.item.phone,null);
 r=await call('put','staff/00000000-0000-4000-8000-000000000999',staff(1));assert.equal(r.status,404);
 r=await call('get','staff/not-a-uuid');assert.equal(r.status,400);
});
test('filters, search and paging never interpolate input',async()=>{
 for(const [n,type] of [[3,'security'],[4,'transport'],[5,'security']]){const r=await call('post','staff',staff(n,{staff_type:type}));assert.equal(r.status,201);}
 let r=await call('get','staff?staff_type=security');assert.equal(r.body.items.length,2);
 r=await call('get','staff?employment_status=inactive');assert.equal(r.body.items.length,1);
 r=await call('get','staff?q=st-4');assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].staff_type,'transport');
 r=await call('get','staff?limit=2&offset=1');assert.equal(r.body.items.length,2);
 r=await call('get',"staff?q=%27%20OR%201%3D1--");assert.equal(r.body.items.length,0);
 for(const bad of ['limit=0','limit=101','offset=-1','staff_type=chef','extra=1']){r=await call('get',`staff?${bad}`);assert.equal(r.status,400);}
});
test('deleting an erroneous record is permanent and unknown ids return 404',async()=>{
 let r=await call('post','staff',staff(9));assert.equal(r.status,201);
 r=await call('delete',`staff/${r.body.item.id}`);assert.equal(r.status,204);
 r=await call('delete','staff/00000000-0000-4000-8000-000000000999');assert.equal(r.status,404);
});


test('staff records are isolated by active school and employee numbers are school-specific',async()=>{
 const schoolB=(await query("INSERT INTO schools(name,slug) VALUES('Staff Test School','staff-test-school') RETURNING id")).rows[0].id;
 const createUser=async(name,role)=>{const email=name+'@example.com';const id=(await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[name,email,hash,role])).rows[0].id;await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolB,id,role]);return email;};
 const email=await createUser('admin-b','admin');
 const login=await request(app).post('/api/auth/login').send({email,password});assert.equal(login.status,200);
 const callB=(method,path,body)=>{const req=request(app)[method]('/api/'+path).set('Authorization','Bearer '+login.body.accessToken);return body?req.send(body):req;};
 let r=await call('post','staff',staff(77));assert.equal(r.status,201);const idA=r.body.item.id;
 r=await callB('get','staff');assert.equal(r.body.items.length,0);
 r=await callB('get','staff/'+idA);assert.equal(r.status,404);
 r=await callB('put','staff/'+idA,staff(77,{name:'Stolen'}));assert.equal(r.status,404);
 r=await callB('delete','staff/'+idA);assert.equal(r.status,404);
 r=await callB('post','staff',staff(77));assert.equal(r.status,201,'employee number can be reused by another school');
 r=await callB('get','staff');assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].employee_number,'ST-77');
});
