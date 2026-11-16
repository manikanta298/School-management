import { pool } from '../config/db.js';
import * as v from '../validators/students.js';
import { fail } from './auth.js';
const exportColumns=['admission_number','name','email','lifecycle_status','admission_date','date_of_birth','gender','blood_group','nationality','address','present_address','city','district','state','pin_code','previous_school','previous_class'];
const cell=value=>{let text=value==null?'':String(value);if(/^[=+\-@\t\r]/.test(text))text=`'${text}`;return `"${text.replaceAll('"','""')}"`;};
export async function exportCsv(schoolId){
 const {rows}=await pool.query("SELECT s.admission_number,u.name,u.email,s.lifecycle_status,s.admission_date::text AS admission_date,s.date_of_birth::text AS date_of_birth,s.gender,s.blood_group,s.nationality,s.address,s.present_address,s.city,s.district,s.state,s.pin_code,s.previous_school,s.previous_class FROM students s JOIN users u ON u.id=s.user_id WHERE s.school_id=$1 ORDER BY s.admission_number",[schoolId]);
 return [exportColumns.join(','),...rows.map(r=>exportColumns.map(c=>cell(r[c])).join(','))].join('\r\n')+'\r\n';
}
export async function bulkUpdate(schoolId,{rows,dry_run}){
 const parsed=rows.map((raw,index)=>({index,raw,result:v.parseBulkRow(raw)}));
 const numbers=parsed.filter(p=>p.result.success).map(p=>p.result.data.admission_number);
 const known=new Map((await pool.query('SELECT id,admission_number,admission_date::text AS admission_date FROM students WHERE school_id=$1 AND admission_number=ANY($2::text[])',[schoolId,numbers])).rows.map(s=>[s.admission_number,s]));
 const seen=new Set(),results=parsed.map(({index,raw,result})=>{
  const errors=[];let student=null;
  if(!result.success)errors.push(...result.error.issues.map(i=>`${i.path.join('.')||'row'}: ${i.message}`));
  else{student=known.get(result.data.admission_number);if(!student)errors.push('admission_number: no student with this admission number in the active school');if(seen.has(result.data.admission_number))errors.push('admission_number: duplicated in this file');seen.add(result.data.admission_number);if(student&&Object.hasOwn(raw,'date_of_birth')&&result.data.date_of_birth&&result.data.date_of_birth>student.admission_date)errors.push('date_of_birth: must be on or before admission');}
  return {row:index+1,admission_number:typeof raw.admission_number==='string'?raw.admission_number:null,errors,student,changes:result.success?v.bulkColumns.filter(c=>Object.hasOwn(raw,c)).map(c=>[c,result.data[c]]):[]};
 });
 const valid=results.every(r=>!r.errors.length);
 if(valid&&!dry_run){const client=await pool.connect();try{await client.query('BEGIN');for(const r of results)if(r.changes.length)await client.query(`UPDATE students SET ${r.changes.map(([c],i)=>`${c}=$${i+1}`).join(',')},updated_at=now() WHERE school_id=$${r.changes.length+1} AND id=$${r.changes.length+2}`,[...r.changes.map(([,value])=>value),schoolId,r.student.id]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
 return {applied:valid&&!dry_run,valid,results:results.map(({row,admission_number,errors,changes})=>({row,admission_number,errors,fields:changes.map(([c])=>c)}))};
}

export async function promote(schoolId,{to_academic_year_id:yearId,enrolled_on,moves,dry_run}){
 const {rows:[year]}=await pool.query('SELECT id,start_date::text AS start_date FROM academic_years WHERE id=$1 AND school_id=$2',[yearId,schoolId]);
 if(!year)throw fail(404,'Target academic year not found');
 const studentIds=[...new Set(moves.map(m=>m.student_id))],sectionIds=[...new Set(moves.map(m=>m.section_id))];
 const students=new Map((await pool.query('SELECT id,lifecycle_status FROM students WHERE school_id=$1 AND id=ANY($2::uuid[])',[schoolId,studentIds])).rows.map(r=>[r.id,r]));
 const sections=new Map((await pool.query('SELECT s.id,s.class_id,c.academic_year_id FROM sections s JOIN classes c ON c.id=s.class_id AND c.school_id=s.school_id WHERE s.school_id=$1 AND s.id=ANY($2::uuid[])',[schoolId,sectionIds])).rows.map(r=>[r.id,r]));
 const sources=new Map((await pool.query("SELECT id,student_id FROM enrollments WHERE school_id=$1 AND student_id=ANY($2::uuid[]) AND status='active' AND academic_year_id<>$3",[schoolId,studentIds,yearId])).rows.map(r=>[r.student_id,r]));
 const already=new Set((await pool.query('SELECT student_id FROM enrollments WHERE school_id=$1 AND student_id=ANY($2::uuid[]) AND academic_year_id=$3',[schoolId,studentIds,yearId])).rows.map(r=>r.student_id));
 const seen=new Set();
 const results=moves.map((m,i)=>{
  const errors=[],student=students.get(m.student_id),section=sections.get(m.section_id);
  if(!student)errors.push('student_id: student not found in the active school');
  else if(student.lifecycle_status!=='active')errors.push(`student_id: student is ${student.lifecycle_status}, only active students can be promoted`);
  if(!section)errors.push('section_id: section not found in the active school');
  else if(section.academic_year_id!==yearId)errors.push('section_id: section does not belong to the target academic year');
  if(seen.has(m.student_id))errors.push('student_id: listed more than once');seen.add(m.student_id);
  if(student&&already.has(m.student_id))errors.push('student_id: already enrolled in the target academic year');
  else if(student&&!sources.has(m.student_id))errors.push('student_id: no active enrollment in another academic year to promote from');
  return {row:i+1,student_id:m.student_id,section_id:m.section_id,errors,section,source:sources.get(m.student_id)};
 });
 const valid=results.every(r=>!r.errors.length);
 if(valid&&!dry_run){
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   for(const r of results){
    await client.query('INSERT INTO enrollments(school_id,student_id,academic_year_id,class_id,section_id,enrolled_on,status) VALUES($1,$2,$3,$4,$5,$6,$7)',[schoolId,r.student_id,yearId,r.section.class_id,r.section_id,enrolled_on||year.start_date,'active']);
    await client.query("UPDATE enrollments SET status='completed',updated_at=now() WHERE school_id=$1 AND id=$2",[schoolId,r.source.id]);
   }
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');if(e.status)throw e;throw fail(409,`Promotion was not applied: ${e.message}`);}finally{client.release();}
 }
 return {applied:valid&&!dry_run,valid,results:results.map(({row,student_id,section_id,errors})=>({row,student_id,section_id,errors}))};
}
