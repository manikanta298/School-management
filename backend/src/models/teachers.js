import { pool } from '../config/db.js';
const teacherSelect=`SELECT t.id,t.school_id,t.user_id,t.employee_number,t.joining_date,t.phone,t.qualification,t.employment_status,t.created_at,t.updated_at,u.name,u.email FROM teachers t JOIN users u ON u.id=t.user_id`;
const assignmentSelect=`SELECT a.id,a.teacher_id,a.class_id,a.academic_year_id,a.kind,a.subject_id,c.name AS class_name,y.name AS academic_year_name,sub.name AS subject_name,sub.code AS subject_code,t.employment_status FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id AND t.school_id=a.school_id JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id JOIN academic_years y ON y.id=a.academic_year_id AND y.school_id=a.school_id LEFT JOIN subjects sub ON sub.id=a.subject_id AND sub.school_id=a.school_id`;
function scope(user,schoolId,values){values.push(schoolId);const school=`t.school_id=$${values.length}`;if(user.role==='admin')return school;values.push(user.id);return `${school} AND t.user_id=$${values.length}`;}
export async function list(user,schoolId,query){
 const values=[],filters=[scope(user,schoolId,values)];
 if(query.q){values.push(query.q);filters.push(`strpos(lower(u.name || ' ' || u.email || ' ' || t.employee_number),lower($${values.length}))>0`);}
 if(query.academic_year_id||query.class_id){const nested=['a.teacher_id=t.id','a.school_id=t.school_id'];for(const key of ['academic_year_id','class_id'])if(query[key]){values.push(query[key]);nested.push(`a.${key}=$${values.length}`);}filters.push(`EXISTS(SELECT 1 FROM teacher_assignments a WHERE ${nested.join(' AND ')})`);}
 values.push(query.limit,query.offset);return (await pool.query(`${teacherSelect} WHERE ${filters.join(' AND ')} ORDER BY u.name,t.id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function find(user,schoolId,id){const values=[];const condition=scope(user,schoolId,values);values.push(id);return (await pool.query(`${teacherSelect} WHERE ${condition} AND t.id=$${values.length}`,values)).rows[0];}
export async function save(schoolId,id,data){
 const values=[schoolId,data.employee_number,data.joining_date,data.phone,data.qualification,data.employment_status];
 if(id){values.push(id);return (await pool.query('UPDATE teachers SET employee_number=$2,joining_date=$3,phone=$4,qualification=$5,employment_status=$6,updated_at=now() WHERE school_id=$1 AND id=$7 RETURNING id',values)).rows[0];}
 values.push(data.user_id);return (await pool.query('INSERT INTO teachers(school_id,employee_number,joining_date,phone,qualification,employment_status,user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',values)).rows[0];
}
export async function remove(schoolId,id){return (await pool.query('DELETE FROM teachers WHERE school_id=$1 AND id=$2 RETURNING id',[schoolId,id])).rows[0];}
export async function assignments(user,schoolId,teacherId,query){
 const values=[schoolId,teacherId],filters=['a.school_id=$1','a.teacher_id=$2',scope(user,schoolId,values)];
 for(const key of ['academic_year_id','class_id'])if(query[key]){values.push(query[key]);filters.push(`a.${key}=$${values.length}`);}
 values.push(query.limit,query.offset);return (await pool.query(`${assignmentSelect} WHERE ${filters.join(' AND ')} ORDER BY y.start_date DESC,c.name,a.kind,a.id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function assignment(user,schoolId,teacherId,id,requireActive=false){
 const values=[schoolId,teacherId,id],filters=['a.school_id=$1','a.teacher_id=$2','a.id=$3',scope(user,schoolId,values)];
 if(requireActive&&user.role!=='admin')filters.push("t.employment_status='active'");
 return (await pool.query(`${assignmentSelect} WHERE ${filters.join(' AND ')}`,values)).rows[0];
}
export async function saveAssignment(schoolId,teacherId,id,data){
 const {rows:[cl]}=await pool.query('SELECT academic_year_id FROM classes WHERE school_id=$1 AND id=$2',[schoolId,data.class_id]);if(!cl)return null;
 const values=[schoolId,teacherId,data.class_id,cl.academic_year_id,data.kind,data.subject_id];
 if(id){values.push(id);return (await pool.query('UPDATE teacher_assignments SET class_id=$3,academic_year_id=$4,kind=$5,subject_id=$6,updated_at=now() WHERE school_id=$1 AND teacher_id=$2 AND id=$7 RETURNING id',values)).rows[0];}
 return (await pool.query('INSERT INTO teacher_assignments(school_id,teacher_id,class_id,academic_year_id,kind,subject_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',values)).rows[0];
}
export async function removeAssignment(schoolId,teacherId,id){return (await pool.query('DELETE FROM teacher_assignments WHERE school_id=$1 AND teacher_id=$2 AND id=$3 RETURNING id',[schoolId,teacherId,id])).rows[0];}
export async function roster(user,schoolId,teacherId,assignmentId,query){
 const values=[schoolId,teacherId,assignmentId],filters=['a.school_id=$1','a.teacher_id=$2','a.id=$3',scope(user,schoolId,values),"e.school_id=a.school_id","e.status='active'"];
 if(user.role!=='admin')filters.push("t.employment_status='active'");
 if(query.q){values.push(query.q);filters.push(`strpos(lower(u.name || ' ' || s.admission_number),lower($${values.length}))>0`);}
 if(query.section_id){values.push(query.section_id);filters.push(`e.section_id=$${values.length}`);}
 values.push(query.limit,query.offset);
 return (await pool.query(`SELECT s.id AS student_id,s.admission_number,u.name,e.id AS enrollment_id,e.section_id,sec.name AS section_name FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id AND t.school_id=a.school_id JOIN enrollments e ON e.class_id=a.class_id AND e.academic_year_id=a.academic_year_id AND e.school_id=a.school_id JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id JOIN users u ON u.id=s.user_id JOIN sections sec ON sec.id=e.section_id AND sec.school_id=e.school_id WHERE ${filters.join(' AND ')} ORDER BY u.name,s.id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
