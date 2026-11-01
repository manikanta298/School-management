import { pool } from '../config/db.js';
const teacherSelect=`SELECT t.id,t.user_id,t.employee_number,t.joining_date,t.phone,t.qualification,t.employment_status,t.created_at,t.updated_at,u.name,u.email FROM teachers t JOIN users u ON u.id=t.user_id`;
const assignmentSelect=`SELECT a.id,a.teacher_id,a.class_id,a.academic_year_id,a.kind,a.subject_id,c.name AS class_name,y.name AS academic_year_name,sub.name AS subject_name,sub.code AS subject_code,t.employment_status FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id JOIN classes c ON c.id=a.class_id JOIN academic_years y ON y.id=a.academic_year_id LEFT JOIN subjects sub ON sub.id=a.subject_id`;
function scope(user,values){if(user.role==='admin')return 'true';values.push(user.id);return `t.user_id=$${values.length}`;}
export async function list(user,query){
 const values=[],filters=[scope(user,values)];
 if(query.q){values.push(query.q);filters.push(`strpos(lower(u.name || ' ' || u.email || ' ' || t.employee_number),lower($${values.length}))>0`);}
 if(query.academic_year_id||query.class_id){const nested=['a.teacher_id=t.id'];for(const key of ['academic_year_id','class_id'])if(query[key]){values.push(query[key]);nested.push(`a.${key}=$${values.length}`);}filters.push(`EXISTS(SELECT 1 FROM teacher_assignments a WHERE ${nested.join(' AND ')})`);}
 values.push(query.limit,query.offset);return (await pool.query(`${teacherSelect} WHERE ${filters.join(' AND ')} ORDER BY u.name,t.id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function find(user,id){const values=[];const condition=scope(user,values);values.push(id);return (await pool.query(`${teacherSelect} WHERE ${condition} AND t.id=$${values.length}`,values)).rows[0];}
export async function save(id,data){
 const values=[data.employee_number,data.joining_date,data.phone,data.qualification,data.employment_status];
 if(id){values.push(id);return (await pool.query('UPDATE teachers SET employee_number=$1,joining_date=$2,phone=$3,qualification=$4,employment_status=$5,updated_at=now() WHERE id=$6 RETURNING id',values)).rows[0];}
 values.push(data.user_id);return (await pool.query('INSERT INTO teachers(employee_number,joining_date,phone,qualification,employment_status,user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',values)).rows[0];
}
export async function remove(id){return (await pool.query('DELETE FROM teachers WHERE id=$1 RETURNING id',[id])).rows[0];}
export async function assignments(user,teacherId,query){
 const values=[teacherId],filters=['a.teacher_id=$1',scope(user,values)];
 for(const key of ['academic_year_id','class_id'])if(query[key]){values.push(query[key]);filters.push(`a.${key}=$${values.length}`);}
 values.push(query.limit,query.offset);return (await pool.query(`${assignmentSelect} WHERE ${filters.join(' AND ')} ORDER BY y.start_date DESC,c.name,a.kind,a.id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function assignment(user,teacherId,id,requireActive=false){
 const values=[teacherId,id],filters=['a.teacher_id=$1','a.id=$2',scope(user,values)];
 if(requireActive&&user.role!=='admin')filters.push("t.employment_status='active'");
 return (await pool.query(`${assignmentSelect} WHERE ${filters.join(' AND ')}`,values)).rows[0];
}
export async function saveAssignment(teacherId,id,data){
 const {rows:[cl]}=await pool.query('SELECT academic_year_id FROM classes WHERE id=$1',[data.class_id]);if(!cl)return null;
 const values=[teacherId,data.class_id,cl.academic_year_id,data.kind,data.subject_id];
 if(id){values.push(id);return (await pool.query('UPDATE teacher_assignments SET class_id=$2,academic_year_id=$3,kind=$4,subject_id=$5,updated_at=now() WHERE teacher_id=$1 AND id=$6 RETURNING id',values)).rows[0];}
 return (await pool.query('INSERT INTO teacher_assignments(teacher_id,class_id,academic_year_id,kind,subject_id) VALUES($1,$2,$3,$4,$5) RETURNING id',values)).rows[0];
}
export async function removeAssignment(teacherId,id){return (await pool.query('DELETE FROM teacher_assignments WHERE teacher_id=$1 AND id=$2 RETURNING id',[teacherId,id])).rows[0];}
export async function roster(user,teacherId,assignmentId,query){
 const values=[teacherId,assignmentId],filters=['a.teacher_id=$1','a.id=$2',scope(user,values),"e.status='active'"];
 if(user.role!=='admin')filters.push("t.employment_status='active'");
 if(query.q){values.push(query.q);filters.push(`strpos(lower(u.name || ' ' || s.admission_number),lower($${values.length}))>0`);}
 if(query.section_id){values.push(query.section_id);filters.push(`e.section_id=$${values.length}`);}
 values.push(query.limit,query.offset);
 // A roster is deliberately narrower than a student profile: no DOB, address, email or guardian details.
 return (await pool.query(`SELECT s.id AS student_id,s.admission_number,u.name,e.id AS enrollment_id,e.section_id,sec.name AS section_name FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id JOIN enrollments e ON e.class_id=a.class_id AND e.academic_year_id=a.academic_year_id JOIN students s ON s.id=e.student_id JOIN users u ON u.id=s.user_id JOIN sections sec ON sec.id=e.section_id WHERE ${filters.join(' AND ')} ORDER BY u.name,s.id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
