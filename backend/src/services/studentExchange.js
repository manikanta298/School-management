import { pool } from '../config/db.js';
import * as v from '../validators/students.js';
const exportColumns=['admission_number','name','email','lifecycle_status','admission_date','date_of_birth','gender','blood_group','nationality','address','present_address','city','district','state','pin_code','previous_school','previous_class'];
// A leading formula character would execute when the file is opened in a spreadsheet.
const cell=value=>{let text=value==null?'':String(value);if(/^[=+\-@\t\r]/.test(text))text=`'${text}`;return `"${text.replaceAll('"','""')}"`;};
export async function exportCsv(){
 const {rows}=await pool.query("SELECT s.admission_number,u.name,u.email,s.lifecycle_status,s.admission_date::text AS admission_date,s.date_of_birth::text AS date_of_birth,s.gender,s.blood_group,s.nationality,s.address,s.present_address,s.city,s.district,s.state,s.pin_code,s.previous_school,s.previous_class FROM students s JOIN users u ON u.id=s.user_id ORDER BY s.admission_number");
 return [exportColumns.join(','),...rows.map(r=>exportColumns.map(c=>cell(r[c])).join(','))].join('\r\n')+'\r\n';
}
export async function bulkUpdate({rows,dry_run}){
 const parsed=rows.map((raw,index)=>({index,raw,result:v.parseBulkRow(raw)}));
 const numbers=parsed.filter(p=>p.result.success).map(p=>p.result.data.admission_number);
 const known=new Map((await pool.query('SELECT id,admission_number,admission_date::text AS admission_date FROM students WHERE admission_number=ANY($1::text[])',[numbers])).rows.map(s=>[s.admission_number,s]));
 const seen=new Set(),results=parsed.map(({index,raw,result})=>{
  const errors=[];let student=null;
  if(!result.success)errors.push(...result.error.issues.map(i=>`${i.path.join('.')||'row'}: ${i.message}`));
  else{
   student=known.get(result.data.admission_number);
   if(!student)errors.push('admission_number: no student with this admission number');
   if(seen.has(result.data.admission_number))errors.push('admission_number: duplicated in this file');
   seen.add(result.data.admission_number);
   if(student&&Object.hasOwn(raw,'date_of_birth')&&result.data.date_of_birth&&result.data.date_of_birth>student.admission_date)errors.push('date_of_birth: must be on or before admission');
  }
  return {row:index+1,admission_number:typeof raw.admission_number==='string'?raw.admission_number:null,errors,student,changes:result.success?v.bulkColumns.filter(c=>Object.hasOwn(raw,c)).map(c=>[c,result.data[c]]):[]};
 });
 const valid=results.every(r=>!r.errors.length);
 if(valid&&!dry_run){
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   for(const r of results)if(r.changes.length)await client.query(`UPDATE students SET ${r.changes.map(([c],i)=>`${c}=$${i+1}`).join(',')},updated_at=now() WHERE id=$${r.changes.length+1}`,[...r.changes.map(([,value])=>value),r.student.id]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 return {applied:valid&&!dry_run,valid,results:results.map(({row,admission_number,errors,changes})=>({row,admission_number,errors,fields:changes.map(([c])=>c)}))};
}
