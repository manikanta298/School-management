import { pool } from '../config/db.js';
const studentSelect=`SELECT s.id,s.school_id,s.user_id,s.admission_number,s.admission_date,s.date_of_birth,s.address,s.gender,s.blood_group,s.nationality,s.present_address,s.city,s.district,s.state,s.pin_code,s.previous_school,s.previous_class,s.lifecycle_status,s.lifecycle_changed_at,s.created_at,s.updated_at,u.name,u.email FROM students s JOIN users u ON u.id=s.user_id`;
const parentSelect=`SELECT p.id,p.school_id,p.user_id,p.phone,p.address,p.created_at,p.updated_at,u.name,u.email FROM parents p JOIN users u ON u.id=p.user_id`;
function scope(user,kind,schoolId,values){
 values.push(schoolId);const school=`${kind==='students'?'s':'p'}.school_id=$${values.length}`;
 if(user.role==='admin')return school;
 values.push(user.id);const bind=`$${values.length}`;
 if(kind==='parents')return `${school} AND p.user_id=${bind}`;
 if(user.role==='student')return `${school} AND s.user_id=${bind}`;
 return `${school} AND EXISTS(SELECT 1 FROM student_parents sp JOIN parents p ON p.id=sp.parent_id AND p.school_id=sp.school_id WHERE sp.student_id=s.id AND sp.school_id=s.school_id AND p.user_id=${bind})`;
}
export async function list(kind,user,schoolId,query){
 const values=[],filters=[scope(user,kind,schoolId,values)],student=kind==='students';
 if(query.q){values.push(query.q);const b=`$${values.length}`;filters.push(`strpos(lower(u.name || ' ' || u.email${student?" || ' ' || s.admission_number":''}),lower(${b}))>0`);}
 if(student&&query.parent_id){values.push(query.parent_id);filters.push(`EXISTS(SELECT 1 FROM student_parents sp WHERE sp.student_id=s.id AND sp.parent_id=$${values.length} AND sp.school_id=s.school_id)`);}
 if(student&&query.status){values.push(query.status);filters.push(`s.lifecycle_status=$${values.length}`);}
 if(student&&(query.academic_year_id||query.section_id)){const nested=['e.student_id=s.id','e.school_id=s.school_id'];for(const field of ['academic_year_id','section_id'])if(query[field]){values.push(query[field]);nested.push(`e.${field}=$${values.length}`);}filters.push(`EXISTS(SELECT 1 FROM enrollments e WHERE ${nested.join(' AND ')})`);}
 values.push(query.limit,query.offset);
 return (await pool.query(`${student?studentSelect:parentSelect} WHERE ${filters.join(' AND ')} ORDER BY u.name,${student?'s':'p'}.id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function find(kind,user,schoolId,id){const values=[];const condition=scope(user,kind,schoolId,values);values.push(id);return (await pool.query(`${kind==='students'?studentSelect:parentSelect} WHERE ${condition} AND ${kind==='students'?'s':'p'}.id=$${values.length}`,values)).rows[0];}
const profileColumns=['gender','blood_group','nationality','present_address','city','district','state','pin_code','previous_school','previous_class'];
export async function saveStudent(schoolId,id,data){
 const values=[schoolId,data.admission_number,data.admission_date,data.date_of_birth,data.address,...profileColumns.map(k=>data[k])];
 if(id){values.push(id);return (await pool.query(`UPDATE students SET admission_number=$2,admission_date=$3,date_of_birth=$4,address=$5,${profileColumns.map((k,i)=>`${k}=$${i+6}`).join(',')},updated_at=now() WHERE school_id=$1 AND id=$${values.length} RETURNING id`,values)).rows[0];}
 values.push(data.user_id);return (await pool.query(`INSERT INTO students(school_id,admission_number,admission_date,date_of_birth,address,${profileColumns.join(',')},user_id) VALUES(${values.map((_,i)=>`$${i+1}`).join(',')}) RETURNING id`,values)).rows[0];
}
export async function setStatus(schoolId,id,actorId,data){
 const closed=data.status==='graduated'?'completed':'withdrawn';
 return (await pool.query(`WITH prev AS (SELECT lifecycle_status FROM students WHERE school_id=$1 AND id=$2 FOR UPDATE),
 upd AS (UPDATE students SET lifecycle_status=$3::varchar,lifecycle_changed_at=now(),updated_at=now() WHERE school_id=$1 AND id=$2 AND EXISTS(SELECT 1 FROM prev) RETURNING id),
 closing AS (UPDATE enrollments SET status=$6::varchar,updated_at=now() WHERE school_id=$1 AND student_id=$2 AND status='active' AND $3::varchar<>'active' AND EXISTS(SELECT 1 FROM upd) RETURNING id),
 hist AS (INSERT INTO student_status_history(school_id,student_id,previous_status,new_status,reason,changed_by) SELECT $1,$2::uuid,prev.lifecycle_status,$3::varchar,$4::varchar,$5::uuid FROM prev,upd RETURNING id)
 SELECT upd.id,(SELECT count(*)::int FROM closing) AS closed_enrollments FROM upd`,[schoolId,id,data.status,data.reason,actorId,closed])).rows[0];
}
export async function statusHistory(schoolId,studentId,query){return (await pool.query('SELECT h.id,h.previous_status,h.new_status,h.reason,h.changed_at,u.name AS changed_by_name FROM student_status_history h JOIN users u ON u.id=h.changed_by WHERE h.school_id=$1 AND h.student_id=$2 ORDER BY h.id DESC LIMIT $3 OFFSET $4',[schoolId,studentId,query.limit,query.offset])).rows;}
export async function saveParent(schoolId,id,data){
 const values=[schoolId,data.phone,data.address];if(id){values.push(id);return (await pool.query('UPDATE parents SET phone=$2,address=$3,updated_at=now() WHERE school_id=$1 AND id=$4 RETURNING id',values)).rows[0];}
 values.push(data.user_id);return (await pool.query('INSERT INTO parents(school_id,phone,address,user_id) VALUES($1,$2,$3,$4) RETURNING id',values)).rows[0];
}
export async function remove(kind,schoolId,id){const table=kind==='students'?'students':'parents';return (await pool.query(`DELETE FROM ${table} WHERE school_id=$1 AND id=$2 RETURNING id`,[schoolId,id])).rows[0];}
export async function links(schoolId,studentId,user,query){
 const values=[schoolId,studentId];let where='sp.school_id=$1 AND sp.student_id=$2';
 if(user.role==='parent'){values.push(user.id);where+=' AND p.user_id=$3';}
 values.push(query.limit,query.offset);
 return (await pool.query(`SELECT sp.parent_id,sp.student_id,sp.relationship,u.name AS parent_name FROM student_parents sp JOIN parents p ON p.id=sp.parent_id AND p.school_id=sp.school_id JOIN users u ON u.id=p.user_id WHERE ${where} ORDER BY u.name,sp.parent_id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function addLink(schoolId,studentId,data){return (await pool.query('INSERT INTO student_parents(school_id,student_id,parent_id,relationship) VALUES($1,$2,$3,$4) RETURNING *',[schoolId,studentId,data.parent_id,data.relationship])).rows[0];}
export async function removeLink(schoolId,studentId,parentId){return (await pool.query('DELETE FROM student_parents WHERE school_id=$1 AND student_id=$2 AND parent_id=$3 RETURNING parent_id',[schoolId,studentId,parentId])).rows[0];}
export async function enrollments(schoolId,studentId,query){return (await pool.query(`SELECT e.id,e.student_id,e.academic_year_id,e.class_id,e.section_id,e.enrolled_on,e.status,y.name AS academic_year_name,c.name AS class_name,s.name AS section_name FROM enrollments e JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=e.school_id JOIN classes c ON c.id=e.class_id AND c.school_id=e.school_id JOIN sections s ON s.id=e.section_id AND s.school_id=e.school_id WHERE e.school_id=$1 AND e.student_id=$2 ORDER BY y.start_date DESC,e.id LIMIT $3 OFFSET $4`,[schoolId,studentId,query.limit,query.offset])).rows;}
export async function saveEnrollment(schoolId,studentId,id,data){
 const {rows:[section]}=await pool.query('SELECT class_id FROM sections WHERE school_id=$1 AND id=$2',[schoolId,data.section_id]);if(!section)return null;
 const values=[schoolId,studentId,data.academic_year_id,section.class_id,data.section_id,data.enrolled_on,data.status];
 if(id){values.push(id);return (await pool.query('UPDATE enrollments SET academic_year_id=$3,class_id=$4,section_id=$5,enrolled_on=$6,status=$7,updated_at=now() WHERE school_id=$1 AND student_id=$2 AND id=$8 RETURNING *',values)).rows[0];}
 return (await pool.query('INSERT INTO enrollments(school_id,student_id,academic_year_id,class_id,section_id,enrolled_on,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',values)).rows[0];
}
export async function removeEnrollment(schoolId,studentId,id){return (await pool.query('DELETE FROM enrollments WHERE school_id=$1 AND student_id=$2 AND id=$3 RETURNING id',[schoolId,studentId,id])).rows[0];}
