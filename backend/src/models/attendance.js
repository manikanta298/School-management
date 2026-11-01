import { pool } from '../config/db.js';
export const sectionSelect=`SELECT s.id,s.name,c.id AS class_id,c.name AS class_name,c.academic_year_id,y.name AS academic_year_name,y.start_date,y.end_date FROM sections s JOIN classes c ON c.id=s.class_id JOIN academic_years y ON y.id=c.academic_year_id`;
export function sectionScope(user,values,write=false){
 if(user.role==='admin')return 'true';values.push(user.id);
 return `EXISTS(SELECT 1 FROM teacher_assignments ta JOIN teachers t ON t.id=ta.teacher_id WHERE ta.class_id=c.id AND ta.academic_year_id=c.academic_year_id AND t.user_id=$${values.length} AND t.employment_status='active' ${write?"AND ta.kind='class_teacher'":''})`;
}
export async function section(user,id,write=false,client=pool){const values=[id],condition=sectionScope(user,values,write);return (await client.query(`${sectionSelect} WHERE s.id=$1 AND ${condition}`,values)).rows[0];}
export async function today(client=pool){return (await client.query('SELECT CURRENT_DATE::text AS today')).rows[0].today;}
export async function sections(user,query){
 const values=[],filters=[sectionScope(user,values)];if(query.academic_year_id){values.push(query.academic_year_id);filters.push(`c.academic_year_id=$${values.length}`);}
 const mark=sectionScope(user,values,true);values.push(query.limit,query.offset);
 const select=sectionSelect.replace(' FROM sections',`,(${mark}) AS can_mark FROM sections`);
 return (await pool.query(`${select} WHERE ${filters.join(' AND ')} ORDER BY y.start_date DESC,c.name,s.name,s.id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}

export async function register(sectionId,date,client=pool){return (await client.query('SELECT id,version,attendance_date FROM attendance_registers WHERE section_id=$1 AND attendance_date=$2',[sectionId,date])).rows[0];}
export async function registerRows(user,sectionId,date,query){
 const values=[sectionId,date],access=sectionScope(user,values);
 values.push(query.limit,query.offset);
 return (await pool.query(`WITH allowed AS (${sectionSelect} WHERE s.id=$1 AND ${access}), saved AS (
 SELECT e.student_id,e.enrollment_id,e.status,e.note FROM attendance_entries e JOIN attendance_registers r ON r.id=e.register_id JOIN allowed x ON x.id=r.section_id WHERE r.attendance_date=$2
 ), eligible AS (
 SELECT en.student_id,en.id AS enrollment_id,NULL::varchar AS status,NULL::varchar AS note FROM enrollments en JOIN allowed x ON x.id=en.section_id AND x.academic_year_id=en.academic_year_id
 WHERE en.status='active' AND en.enrolled_on<=$2 AND NOT EXISTS(SELECT 1 FROM saved z WHERE z.student_id=en.student_id)
 AND NOT EXISTS(SELECT 1 FROM attendance_entries z WHERE z.student_id=en.student_id AND z.attendance_date=$2 AND z.status<>'void')
 ) SELECT x.student_id,x.enrollment_id,x.status,x.note,u.name,s.admission_number FROM (SELECT * FROM saved UNION ALL SELECT * FROM eligible) x JOIN students s ON s.id=x.student_id JOIN users u ON u.id=s.user_id ORDER BY u.name,s.id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
const counts=`count(*) FILTER(WHERE e.status='present')::int AS present,count(*) FILTER(WHERE e.status='absent')::int AS absent,count(*) FILTER(WHERE e.status='late')::int AS late,count(*) FILTER(WHERE e.status='excused')::int AS excused,count(*) FILTER(WHERE e.status='void')::int AS voided,count(*) FILTER(WHERE e.status<>'void')::int AS recorded_days,round(100.0*count(*) FILTER(WHERE e.status IN ('present','late'))/NULLIF(count(*) FILTER(WHERE e.status IN ('present','late','absent')),0),2) AS attendance_percentage`;
export async function summary(user,query){const values=[query.section_id,query.from,query.to],access=sectionScope(user,values);return (await pool.query(`SELECT st.id AS student_id,u.name,st.admission_number,${counts} FROM attendance_entries e JOIN attendance_registers r ON r.id=e.register_id JOIN sections s ON s.id=r.section_id JOIN classes c ON c.id=s.class_id JOIN students st ON st.id=e.student_id JOIN users u ON u.id=st.user_id WHERE r.section_id=$1 AND r.attendance_date BETWEEN $2 AND $3 AND ${access} GROUP BY st.id,u.name ORDER BY u.name,st.id`,values)).rows;}
function studentScope(user,values){if(user.role==='admin')return 'true';values.push(user.id);return user.role==='student'?`st.user_id=$${values.length}`:`EXISTS(SELECT 1 FROM student_parents sp JOIN parents p ON p.id=sp.parent_id WHERE sp.student_id=st.id AND p.user_id=$${values.length})`;}
export async function studentHistory(user,studentId,query){
 const values=[studentId,query.from,query.to],access=studentScope(user,values),base=`FROM attendance_entries e JOIN students st ON st.id=e.student_id JOIN attendance_registers r ON r.id=e.register_id JOIN sections s ON s.id=r.section_id JOIN classes c ON c.id=r.class_id JOIN academic_years y ON y.id=r.academic_year_id WHERE e.student_id=$1 AND e.attendance_date BETWEEN $2 AND $3 AND ${access}`;
 const summary=(await pool.query(`SELECT ${counts} ${base}`,values)).rows[0];
 values.push(query.limit,query.offset);
 const items=(await pool.query(`SELECT e.attendance_date,e.status,e.note,s.name AS section_name,c.name AS class_name,y.name AS academic_year_name ${base} ORDER BY e.attendance_date DESC,e.id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
 return {items,summary};
}
export async function audit(query){return (await pool.query(`SELECT a.id,a.previous_status,a.previous_note,a.new_status,a.new_note,a.reason,a.changed_at,u.name AS changed_by_name,st.admission_number,us.name AS student_name FROM attendance_audit a JOIN attendance_entries e ON e.id=a.entry_id JOIN attendance_registers r ON r.id=e.register_id JOIN students st ON st.id=e.student_id JOIN users us ON us.id=st.user_id JOIN users u ON u.id=a.changed_by WHERE r.section_id=$1 AND r.attendance_date=$2 ORDER BY a.id DESC LIMIT $3 OFFSET $4`,[query.section_id,query.date,query.limit,query.offset])).rows;}
