import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import request from 'supertest';
process.env.NODE_ENV='test';process.env.JWT_SECRET='exchange-test-secret'.repeat(4);process.env.DATABASE_URL='postgres://test:test@localhost/test';process.env.FRONTEND_ORIGIN='http://localhost:5173';
const {pool}=await import('../src/config/db.js');const db=new PGlite();
await db.exec(await readFile(new URL('../database/schema.sql',import.meta.url),'utf8'));
const query=async(text,params)=>{const r=await db.query(text,params);return {...r,rowCount:r.rows.length||r.affectedRows||0};};pool.query=query;pool.connect=async()=>({query,release(){}});
const {app}=await import('../src/app.js');const {hashPassword}=await import('../src/services/auth.js');
const hash=await hashPassword('ExchangePassword!123'),tokens={};
for(const role of ['admin','teacher','student','parent']){
 await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)',[role,`${role}@example.com`,hash,role]);
 const login=await request(app).post('/api/auth/login').send({email:`${role}@example.com`,password:'ExchangePassword!123'});assert.equal(login.status,200);tokens[role]=login.body.accessToken;
}
for(const n of [1,2]){
 await query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'student')",[`Pupil ${n}`,`pupil${n}@example.com`,hash]);
 await query("INSERT INTO students(user_id,admission_number,admission_date,date_of_birth,city) SELECT id,$2,'2025-01-01','2015-05-05','Old city' FROM users WHERE email=$1",[`pupil${n}@example.com`,`ADM${n}`]);
}
const call=(method,path,body,who='admin')=>{const req=request(app)[method]('/api/'+path).set('Authorization',`Bearer ${tokens[who]}`);return body?req.send(body):req;};
const student=async n=>(await query('SELECT * FROM students WHERE admission_number=$1',[`ADM${n}`])).rows[0];
after(async()=>{await db.close();await pool.end();});
test('CSV export is admin-only, complete and neutralises spreadsheet formulas',async()=>{
 for(const who of ['teacher','student','parent']){const r=await call('get','students/export.csv',undefined,who);assert.equal(r.status,403);}
 let r=await request(app).get('/api/students/export.csv');assert.equal(r.status,401);
 await query("UPDATE students SET nationality='=HYPERLINK(\"http://evil\")' WHERE admission_number='ADM1'");
 r=await call('get','students/export.csv');assert.equal(r.status,200);assert.match(r.headers['content-type'],/text\/csv/);assert.match(r.headers['content-disposition'],/students\.csv/);
 const lines=r.text.trim().split('\r\n');assert.equal(lines.length,3);assert.match(lines[0],/^admission_number,name,email,lifecycle_status,admission_date,date_of_birth/);
 assert.ok(lines[1].startsWith('"ADM1","Pupil 1","pupil1@example.com","active","2025-01-01","2015-05-05"'));assert.ok(lines[1].includes('"\'=HYPERLINK(""http://evil"")"'));
});
test('bulk update previews, validates every row and applies atomically',async()=>{
 const rows=[{admission_number:'adm1',city:'Hyderabad',pin_code:'500001'},{admission_number:'ADM2',gender:'female',blood_group:'O+'}];
 let r=await call('post','students/bulk-update',{rows});assert.equal(r.status,200);assert.equal(r.body.valid,true);assert.equal(r.body.applied,false);assert.deepEqual(r.body.results.map(x=>x.fields),[['city','pin_code'],['gender','blood_group']]);
 assert.equal((await student(1)).city,'Old city');
 r=await call('post','students/bulk-update',{dry_run:false,rows:[...rows,{admission_number:'NOPE',city:'X'},{admission_number:'ADM2',pin_code:'12'},{admission_number:'ADM1',date_of_birth:'2030-01-01'},{admission_number:'ADM1',unknown:'x'}]});
 assert.equal(r.status,200);assert.equal(r.body.applied,false);assert.equal(r.body.valid,false);
 assert.deepEqual(r.body.results.map(x=>x.errors.length>0),[false,false,true,true,true,true]);assert.match(r.body.results[2].errors[0],/no student/);assert.match(r.body.results[4].errors.join(),/on or before admission/);
 assert.equal((await student(1)).city,'Old city');assert.equal((await student(2)).gender,null);
 r=await call('post','students/bulk-update',{dry_run:false,rows});assert.equal(r.body.applied,true);
 const one=await student(1),two=await student(2);assert.equal(one.city,'Hyderabad');assert.equal(one.pin_code,'500001');assert.equal(one.date_of_birth.toISOString?.().slice(0,10)??String(one.date_of_birth).slice(0,10),'2015-05-05');assert.equal(two.gender,'female');assert.equal(two.blood_group,'O+');
 r=await call('post','students/bulk-update',{dry_run:false,rows:[{admission_number:'ADM1',city:null}]});assert.equal(r.body.applied,true);assert.equal((await student(1)).city,null);
});
test('CSV export reference columns round-trip but cannot modify identity fields',async()=>{
 const row={admission_number:'ADM1',name:'Pupil 1',email:'pupil1@example.com',lifecycle_status:'active',admission_date:'2025-01-01',city:'Updated city'};
 const r=await call('post','students/bulk-update',{dry_run:false,rows:[row]});assert.equal(r.status,200);assert.equal(r.body.applied,true);assert.deepEqual(r.body.results[0].fields,['city']);
 assert.equal((await student(1)).city,'Updated city');assert.equal((await student(1)).admission_number,'ADM1');
});
test('bulk update rejects malformed envelopes and non-admins',async()=>{
 for(const body of [{rows:[]},{rows:Array.from({length:201},(_,i)=>({admission_number:`A${i}`}))},{rows:[{admission_number:'ADM1'}],extra:1},{rows:'x'},{dry_run:'yes',rows:[{admission_number:'ADM1'}]}]){const r=await call('post','students/bulk-update',body);assert.equal(r.status,400);}
 for(const who of ['teacher','student','parent']){const r=await call('post','students/bulk-update',{rows:[{admission_number:'ADM1',city:'X'}]},who);assert.equal(r.status,403);}
 const r=await call('post','students/bulk-update',{dry_run:false,rows:[{admission_number:'ADM1',city:'<script>'}]});assert.equal(r.body.applied,false);assert.ok(r.body.results[0].errors.length);
});
