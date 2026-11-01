import { pool } from '../config/db.js';
const studentSelect=`SELECT s.id,s.user_id,s.admission_number,s.admission_date,s.date_of_birth,s.address,s.created_at,s.updated_at,u.name,u.email FROM students s JOIN users u ON u.id=s.user_id`;
const parentSelect=`SELECT p.id,p.user_id,p.phone,p.address,p.created_at,p.updated_at,u.name,u.email FROM parents p JOIN users u ON u.id=p.user_id`;
function scope(user,kind,values){
 if(user.role==='admin')return 'true';
 values.push(user.id);const bind=`$${values.length}`;
 if(kind==='parents')return `p.user_id=${bind}`;
 if(user.role==='student')return `s.user_id=${bind}`;
 return `EXISTS(SELECT 1 FROM student_parents sp JOIN parents p ON p.id=sp.parent_id WHERE sp.student_id=s.id AND p.user_id=${bind})`;
}
export async function list(kind,user,query){
 const values=[],filters=[scope(user,kind,values)],student=kind==='students';
 if(query.q){values.push(query.q);const b=`$${values.length}`;filters.push(`strpos(lower(u.name || ' ' || u.email${student?" || ' ' || s.admission_number":''}),lower(${b}))>0`);}
 if(student&&query.parent_id){values.push(query.parent_id);filters.push(`EXISTS(SELECT 1 FROM student_parents sp WHERE sp.student_id=s.id AND sp.parent_id=$${values.length})`);}
 if(student&&(query.academic_year_id||query.section_id)){
 const nested=['e.student_id=s.id'];for(const field of ['academic_year_id','section_id'])if(query[field]){values.push(query[field]);nested.push(`e.${field}=$${values.length}`);}
 filters.push(`EXISTS(SELECT 1 FROM enrollments e WHERE ${nested.join(' AND ')})`);
 }
 values.push(query.limit,query.offset);
 return (await pool.query(`${student?studentSelect:parentSelect} WHERE ${filters.join(' AND ')} ORDER BY u.name,${student?'s':'p'}.id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function find(kind,user,id){const values=[];const condition=scope(user,kind,values);values.push(id);return (await pool.query(`${kind==='students'?studentSelect:parentSelect} WHERE ${condition} AND ${kind==='students'?'s':'p'}.id=$${values.length}`,values)).rows[0];}
export async function saveStudent(id,data){
 const values=[data.admission_number,data.admission_date,data.date_of_birth,data.address];
 if(id){values.push(id);return (await pool.query('UPDATE students SET admission_number=$1,admission_date=$2,date_of_birth=$3,address=$4,updated_at=now() WHERE id=$5 RETURNING id',values)).rows[0];}
 values.push(data.user_id);return (await pool.query('INSERT INTO students(admission_number,admission_date,date_of_birth,address,user_id) VALUES($1,$2,$3,$4,$5) RETURNING id',values)).rows[0];
}
export async function saveParent(id,data){
 const values=[data.phone,data.address];if(id){values.push(id);return (await pool.query('UPDATE parents SET phone=$1,address=$2,updated_at=now() WHERE id=$3 RETURNING id',values)).rows[0];}
 values.push(data.user_id);return (await pool.query('INSERT INTO parents(phone,address,user_id) VALUES($1,$2,$3) RETURNING id',values)).rows[0];
}
export async function remove(kind,id){
 const sql=kind==='students'?'DELETE FROM students WHERE id=$1 RETURNING id':'DELETE FROM parents WHERE id=$1 RETURNING id';
 return (await pool.query(sql,[id])).rows[0];
}
export async function links(studentId,user,query){
 const values=[studentId];let where='sp.student_id=$1';
 if(user.role==='parent'){values.push(user.id);where+=' AND p.user_id=$2';}
 values.push(query.limit,query.offset);
 return (await pool.query(`SELECT sp.parent_id,sp.student_id,sp.relationship,u.name AS parent_name FROM student_parents sp JOIN parents p ON p.id=sp.parent_id JOIN users u ON u.id=p.user_id WHERE ${where} ORDER BY u.name,sp.parent_id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function addLink(studentId,data){return (await pool.query('INSERT INTO student_parents(student_id,parent_id,relationship) VALUES($1,$2,$3) RETURNING *',[studentId,data.parent_id,data.relationship])).rows[0];}
export async function removeLink(studentId,parentId){return (await pool.query('DELETE FROM student_parents WHERE student_id=$1 AND parent_id=$2 RETURNING parent_id',[studentId,parentId])).rows[0];}
export async function enrollments(studentId,query){return (await pool.query(`SELECT e.id,e.student_id,e.academic_year_id,e.class_id,e.section_id,e.enrolled_on,e.status,y.name AS academic_year_name,c.name AS class_name,s.name AS section_name FROM enrollments e JOIN academic_years y ON y.id=e.academic_year_id JOIN classes c ON c.id=e.class_id JOIN sections s ON s.id=e.section_id WHERE e.student_id=$1 ORDER BY y.start_date DESC,e.id LIMIT $2 OFFSET $3`,[studentId,query.limit,query.offset])).rows;}
export async function saveEnrollment(studentId,id,data){
 // Derive the class from the section on the server. Composite FKs enforce year/class/section consistency.
 const {rows:[section]}=await pool.query('SELECT class_id FROM sections WHERE id=$1',[data.section_id]);
 if(!section)return null;
 const values=[studentId,data.academic_year_id,section.class_id,data.section_id,data.enrolled_on,data.status];
 if(id){values.push(id);return (await pool.query('UPDATE enrollments SET academic_year_id=$2,class_id=$3,section_id=$4,enrolled_on=$5,status=$6,updated_at=now() WHERE student_id=$1 AND id=$7 RETURNING *',values)).rows[0];}
 return (await pool.query('INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',values)).rows[0];
}
export async function removeEnrollment(studentId,id){return (await pool.query('DELETE FROM enrollments WHERE student_id=$1 AND id=$2 RETURNING id',[studentId,id])).rows[0];}
