import { pool } from '../config/db.js';
import * as model from '../models/attendance.js';
import { find as findStudent } from './students.js';
import { fail } from './auth.js';
export async function sections(user,query){return {items:await model.sections(user,query),today:await model.today()};}
async function section(user,id,write=false,client=pool){const result=await model.section(user,id,write,client);if(!result)throw fail(404,'Section not found or attendance access unavailable');return result;}
function dateOnly(value){return value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);}
function checkDate(date,sec,today){if(date<dateOnly(sec.start_date)||date>dateOnly(sec.end_date)||date>today)throw fail(400,'Choose a date within the academic year, on or before today');}
export async function register(user,query){const sec=await section(user,query.section_id);checkDate(query.date,sec,await model.today());return {register:await model.register(sec.id,query.date)||null,items:await model.registerRows(user,sec.id,query.date,query)};}
export async function summary(user,query){await section(user,query.section_id);return {items:await model.summary(user,query)};}
export async function history(user,studentId,query){await findStudent('students',user,studentId);return model.studentHistory(user,studentId,query);}
export async function audit(user,query){await section(user,query.section_id);return {items:await model.audit(query)};}
export async function save(user,data){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[data.section_id+':'+data.date]);
  const sec=await section(user,data.section_id,true,c);checkDate(data.date,sec,await model.today(c));
  const {rows:[actor]}=await c.query('SELECT role,active FROM users WHERE id=$1 FOR SHARE',[user.id]);
  if(!actor?.active||actor.role!==user.role)throw fail(401,'Authentication required');
  if(user.role==='teacher'){
   const {rows:[assignment]}=await c.query("SELECT t.joining_date FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id WHERE a.class_id=$1 AND a.kind='class_teacher' AND t.user_id=$2 AND t.employment_status='active' FOR SHARE OF a,t",[sec.class_id,user.id]);
   if(!assignment)throw fail(404,'Attendance marking access unavailable');
   if(data.date<dateOnly(assignment.joining_date))throw fail(400,'Teachers cannot mark dates before their joining date');
  }
  await c.query('INSERT INTO attendance_registers(section_id,class_id,academic_year_id,attendance_date,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(section_id,attendance_date) DO NOTHING',[sec.id,sec.class_id,sec.academic_year_id,data.date,user.id]);
  const {rows:[reg]}=await c.query('SELECT id,version FROM attendance_registers WHERE section_id=$1 AND attendance_date=$2 FOR UPDATE',[sec.id,data.date]);
  if(reg.version!==data.expected_version)throw fail(409,'Register changed. Reload it before saving your changes.');
  let changed=0;
  for(const entry of [...data.entries].sort((a,b)=>a.student_id.localeCompare(b.student_id))){
   const {rows:[existing]}=await c.query('SELECT id,status,note FROM attendance_entries WHERE register_id=$1 AND student_id=$2 FOR UPDATE',[reg.id,entry.student_id]);
   if(existing){
    if(existing.status===entry.status&&existing.note===entry.note)continue;
    if(!data.correction_reason||data.correction_reason.length<3)throw fail(400,'A correction reason of at least 3 characters is required');
    await c.query('UPDATE attendance_entries SET status=$1,note=$2,change_reason=$3,updated_by=$4,updated_at=now() WHERE id=$5',[entry.status,entry.note,data.correction_reason,user.id,existing.id]);
   }else{
    if(entry.status==='void')throw fail(400,'Only saved attendance can be voided');
    const {rows:[enrollment]}=await c.query("SELECT id FROM enrollments WHERE student_id=$1 AND section_id=$2 AND academic_year_id=$3 AND status='active' AND enrolled_on<=$4 FOR SHARE",[entry.student_id,sec.id,sec.academic_year_id,data.date]);
    if(!enrollment)throw fail(400,'A student is not eligible for this section and date');
    await c.query('INSERT INTO attendance_entries(register_id,attendance_date,student_id,enrollment_id,status,note,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[reg.id,data.date,entry.student_id,enrollment.id,entry.status,entry.note,user.id]);
   }
   changed++;
  }
  if(changed)await c.query('UPDATE attendance_registers SET version=version+1,updated_at=now() WHERE id=$1',[reg.id]);
  await c.query('COMMIT');return {version:reg.version+(changed?1:0),changed};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export async function calendar(){return {today:await model.today()};}
