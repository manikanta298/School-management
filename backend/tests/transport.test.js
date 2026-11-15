import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='transport-test-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const hash=await hashPassword('TransportPassword!123'),accounts={},tokens={},ids={};
const schoolId=(await query("SELECT id FROM schools WHERE slug='existing-school'")).rows[0].id;
const insert=async(sql,params)=>(await query(sql,params)).rows[0].id;
for(const [key,role] of [['admin','admin'],['teacher','teacher'],['s1','student'],['s2','student'],['s3','student'],['parent','parent'],['outsider','parent']]){
 accounts[key]=await insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',[key,`${key}@example.com`,hash,role]);
 await query('INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,\'active\',true)',[schoolId,accounts[key],role]);
 const login=await request(app).post('/api/auth/login').send({email:`${key}@example.com`,password:'TransportPassword!123'});assert.equal(login.status,200);tokens[key]=login.body.accessToken;
}
const call=(method,path,body,who='admin')=>{const req=request(app)[method]('/api/'+path).set('Authorization',`Bearer ${tokens[who]}`);return body?req.send(body):req;};
const day=offset=>{const d=new Date();d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
ids.year=await insert("INSERT INTO academic_years(name,start_date,end_date,is_current,school_id) VALUES('Current',CURRENT_DATE-60,CURRENT_DATE+300,true,$1) RETURNING id",[schoolId]);
for(const key of ['s1','s2','s3'])ids[key]=await insert('INSERT INTO students(user_id,admission_number,admission_date,school_id) VALUES($1,$2,CURRENT_DATE-90,$3) RETURNING id',[accounts[key],key.toUpperCase(),schoolId]);
ids.parent=await insert('INSERT INTO parents(user_id,school_id) VALUES($1,$2) RETURNING id',[accounts.parent,schoolId]);await insert('INSERT INTO parents(user_id,school_id) VALUES($1,$2) RETURNING id',[accounts.outsider,schoolId]);
await query("INSERT INTO student_parents(student_id,parent_id,relationship) VALUES($1,$2,'guardian')",[ids.s1,ids.parent]);
after(async()=>{await db.close();await pool.end();});
const vehicle=(extra={})=>({registration_number:'ts 09 ab 1234',capacity:2,driver_name:'Ravi',driver_phone:'+91 98765 43210',insurance_expiry:day(100),permit_expiry:day(100),...extra});
test('only admins manage vehicles; expiry alerts and validation work',async()=>{
 let r=await request(app).get('/api/transport/vehicles');assert.equal(r.status,401);
 for(const who of ['teacher','s1','parent']){r=await call('get','transport/vehicles',undefined,who);assert.equal(r.status,403);r=await call('post','transport/vehicles',vehicle(),who);assert.equal(r.status,403);}
 r=await call('post','transport/vehicles',vehicle());assert.equal(r.status,201);ids.bus=r.body.item.id;assert.equal(r.body.item.registration_number,'TS 09 AB 1234');assert.equal(r.body.item.insurance_status,'ok');
 r=await call('post','transport/vehicles',vehicle({registration_number:'TS 09 AB 5678',insurance_expiry:day(-1),permit_expiry:day(10)}));assert.equal(r.status,201);ids.bus2=r.body.item.id;assert.equal(r.body.item.insurance_status,'expired');assert.equal(r.body.item.permit_status,'expiring');
 r=await call('post','transport/vehicles',vehicle({insurance_expiry:null,permit_expiry:null,registration_number:'TS 09 AB 9999'}));assert.equal(r.body.item.insurance_status,null);
 r=await call('post','transport/vehicles',vehicle());assert.equal(r.status,409);
 for(const bad of [{capacity:0},{capacity:201},{registration_number:'x'},{driver_phone:'abc'},{insurance_expiry:'2024-02-30'},{extra:1},{driver_name:'<b>'}]){r=await call('post','transport/vehicles',vehicle({registration_number:'TS 01 ZZ 0001',...bad}));assert.equal(r.status,400);}
 r=await call('put',`transport/vehicles/${ids.bus}`,vehicle({driver_name:'Suresh'}));assert.equal(r.status,200);assert.equal(r.body.item.driver_name,'Suresh');
 r=await call('put','transport/vehicles/00000000-0000-4000-8000-000000000999',vehicle());assert.equal(r.status,404);
 r=await call('get','transport/vehicles');assert.equal(r.body.items.length,3);
});
test('routes keep ordered stops and reject duplicates and unknown references',async()=>{
 let r=await call('post','transport/routes',{name:'North',vehicle_id:ids.bus});assert.equal(r.status,201);ids.route=r.body.item.id;assert.equal(r.body.item.vehicle_registration,'TS 09 AB 1234');
 r=await call('post','transport/routes',{name:'NORTH'});assert.equal(r.status,409);
 r=await call('post','transport/routes',{name:'Ghost',vehicle_id:'00000000-0000-4000-8000-000000000999'});assert.equal(r.status,409);
 r=await call('post',`transport/routes/${ids.route}/stops`,{name:'Market',sequence:2});assert.equal(r.status,201);
 r=await call('post',`transport/routes/${ids.route}/stops`,{name:'Temple',sequence:1});assert.deepEqual(r.body.item.stops.map(s=>s.name),['Temple','Market']);ids.stop1=r.body.item.stops[0].id;ids.stop2=r.body.item.stops[1].id;
 r=await call('post',`transport/routes/${ids.route}/stops`,{name:'Dup',sequence:1});assert.equal(r.status,409);
 r=await call('post','transport/routes/00000000-0000-4000-8000-000000000999/stops',{name:'X',sequence:1});assert.equal(r.status,404);
 r=await call('post',`transport/routes/${ids.route}/stops`,{name:'Bad',sequence:0});assert.equal(r.status,400);
 r=await call('put',`transport/stops/${ids.stop2}`,{name:'Market Square',sequence:2});assert.equal(r.status,200);
 r=await call('put',`transport/routes/${ids.route}`,{name:'North',vehicle_id:ids.bus,active:true});assert.equal(r.status,200);
});
test('allocations are scoped, unique per year and limited by vehicle capacity',async()=>{
 const body=(student,stop=ids.stop1)=>({student_id:ids[student],stop_id:stop,academic_year_id:ids.year});
 let r=await call('post','transport/allocations',body('s1'));assert.equal(r.status,201);ids.a1=r.body.item.id;
 r=await call('post','transport/allocations',body('s1',ids.stop2));assert.equal(r.status,409);
 r=await call('post','transport/allocations',body('s2',ids.stop2));assert.equal(r.status,201);ids.a2=r.body.item.id;
 r=await call('post','transport/allocations',body('s3'));assert.equal(r.status,400);
 r=await call('put',`transport/vehicles/${ids.bus}`,vehicle({capacity:1}));assert.equal(r.status,400);
 r=await call('put',`transport/routes/${ids.route}`,{name:'North',vehicle_id:ids.bus2,active:true});assert.equal(r.status,200);
 r=await call('put',`transport/routes/${ids.route}`,{name:'North',vehicle_id:ids.bus,active:true});assert.equal(r.status,200);
 r=await call('get','transport/allocations');assert.equal(r.body.items.length,2);assert.equal(r.body.items[0].driver_phone,'+91 98765 43210');assert.equal(r.body.items[0].stop_name,'Temple');
 for(const [who,count] of [['s1',1],['parent',1],['s2',1],['s3',0],['outsider',0]]){r=await call('get','transport/allocations',undefined,who);assert.equal(r.body.items.length,count,who);}
 r=await call('get','transport/allocations',undefined,'parent');assert.equal(r.body.items[0].student_id,ids.s1);assert.equal(r.body.items[0].driver_phone,undefined);assert.equal(r.body.items[0].vehicle_registration,'TS 09 AB 1234');
 r=await call('get','transport/allocations',undefined,'teacher');assert.equal(r.status,403);
 for(const who of ['s1','parent']){r=await call('post','transport/allocations',body('s3'),who);assert.equal(r.status,403);r=await call('delete',`transport/allocations/${ids.a1}`,undefined,who);assert.equal(r.status,403);}
 r=await call('get',`transport/allocations?route_id=${ids.route}&limit=1`);assert.equal(r.body.items.length,1);
 r=await call('get','transport/allocations?limit=0');assert.equal(r.status,400);
 r=await call('put',`transport/allocations/${ids.a1}`,{stop_id:ids.stop2});assert.equal(r.status,200);
 r=await call('delete',`transport/stops/${ids.stop2}`);assert.equal(r.status,409);
 r=await call('delete',`transport/allocations/${ids.a2}`);assert.equal(r.status,204);
 r=await call('post','transport/allocations',body('s3'));assert.equal(r.status,201);
 r=await call('delete',`transport/allocations/${ids.a2}`);assert.equal(r.status,404);
 const south=await call('post','transport/routes',{name:'South',vehicle_id:null});assert.equal(south.status,201);
 const southStop=await call('post',`transport/routes/${south.body.item.id}/stops`,{name:'Hill',sequence:1});assert.equal(southStop.status,201);
 r=await call('post','transport/allocations',body('s2',southStop.body.item.stops[0].id));assert.equal(r.status,201);
 r=await call('put',`transport/routes/${south.body.item.id}`,{name:'South',vehicle_id:ids.bus,active:true});assert.equal(r.status,400);
 r=await call('get','transport/allocations');assert.equal(r.body.items.find(a=>a.student_id===ids.s2).vehicle_registration,null);
});

test('transport records and relationships are isolated by active school',async()=>{
 const schoolB=await insert("INSERT INTO schools(name,slug) VALUES('Second School','second-school') RETURNING id");
 const userB=await insert("INSERT INTO users(name,email,password_hash,role) VALUES('Second Admin','second-admin@example.com',$1,'admin') RETURNING id",[hash]);
 await query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,'admin','active',true)",[schoolB,userB]);
 const login=await request(app).post('/api/auth/login').send({email:'second-admin@example.com',password:'TransportPassword!123'});
 assert.equal(login.status,200);const tokenB=login.body.accessToken;
 const callB=(method,path,body)=>{const req=request(app)[method]('/api/'+path).set('Authorization',`Bearer ${tokenB}`);return body?req.send(body):req;};
 let r=await callB('get','transport/vehicles');assert.equal(r.status,200);assert.equal(r.body.items.length,0);
 r=await callB('post','transport/vehicles',vehicle());assert.equal(r.status,201);const busB=r.body.item.id;
 r=await callB('get','transport/vehicles');assert.equal(r.body.items.length,1);
 r=await callB('get','transport/routes');assert.equal(r.body.items.length,0);
 r=await callB('post','transport/routes',{name:'North',vehicle_id:ids.bus});assert.equal(r.status,409,'cross-school vehicle reference must be rejected');
 r=await callB('post','transport/routes',{name:'North',vehicle_id:busB});assert.equal(r.status,201);const routeB=r.body.item.id;
 r=await callB('post',`transport/routes/${routeB}/stops`,{name:'Market',sequence:1});assert.equal(r.status,201);const stopB=r.body.item.stops[0].id;
 r=await callB('post','transport/allocations',{student_id:ids.s1,stop_id:stopB,academic_year_id:ids.year});assert.equal(r.status,409,'cross-school student and academic year references must be rejected');
 r=await callB('put',`transport/vehicles/${ids.bus}`,vehicle({driver_name:'Hijack'}));assert.equal(r.status,404,'school B cannot update school A vehicle');
 const schoolA=await call('get','transport/vehicles');assert.equal(schoolA.body.items.length,3,'school A must not see school B vehicle');
 const routesA=await call('get','transport/routes');assert.equal(routesA.body.items.length,2,'school A must not see school B route');
});
