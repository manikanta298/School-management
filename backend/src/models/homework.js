import { pool } from '../config/db.js';
import { studentScope } from './dashboard.js';
const select=`SELECT h.id,h.section_id,h.class_id,h.academic_year_id,h.subject_id,h.title,h.details,h.assigned_on::text AS assigned_on,h.due_on::text AS due_on,h.archived_at,h.created_at,h.updated_at,sub.name AS subject_name,cl.name AS class_name,sec.name AS section_name,u.name AS posted_by FROM homework h JOIN subjects sub ON sub.id=h.subject_id JOIN classes cl ON cl.id=h.class_id JOIN sections sec ON sec.id=h.section_id JOIN users u ON u.id=h.created_by`;
function scopeInner(user,values){
 if(user.role==='admin')return 'true';
 values.push(user.id);const b=`$${values.length}`;
 if(user.role==='teacher')return `EXISTS(SELECT 1 FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id WHERE t.user_id=${b} AND t.employment_status='active' AND a.class_id=h.class_id)`;
 const family=user.role==='student'?`s.user_id=${b}`:`EXISTS(SELECT 1 FROM student_parents sp JOIN parents p ON p.id=sp.parent_id WHERE sp.student_id=s.id AND p.user_id=${b})`;
 return `h.archived_at IS NULL AND EXISTS(SELECT 1 FROM enrollments en JOIN students s ON s.id=en.student_id WHERE en.section_id=h.section_id AND en.status='active' AND ${family})`;
}
function completionColumn(user,values){
 if(user.role==='admin'||user.role==='teacher')return '(SELECT count(*)::int FROM homework_completions c WHERE c.homework_id=h.id) AS completion_count';
 return `coalesce((SELECT array_agg(c.student_id) FROM homework_completions c JOIN students s ON s.id=c.student_id WHERE c.homework_id=h.id AND ${studentScope(user,values)}),'{}') AS completed_student_ids`;
}
function scope(user,values){values.push(user.schoolId);const n=values.length;return `h.school_id=$${n} AND (${scopeInner(user,values)})`;}
export async function list(user,query){
 const values=[],column=completionColumn(user,values),filters=[scope(user,values)];
 if(query.include_archived!=='true'||!['admin','teacher'].includes(user.role))filters.push('h.archived_at IS NULL');
 for(const [key,col] of [['section_id','h.section_id'],['subject_id','h.subject_id']])if(query[key]){values.push(query[key]);filters.push(`${col}=$${values.length}`);}
 if(query.due_from){values.push(query.due_from);filters.push(`h.due_on>=$${values.length}`);}
 if(query.due_to){values.push(query.due_to);filters.push(`h.due_on<=$${values.length}`);}
 if(query.student_id){values.push(query.student_id);filters.push(`EXISTS(SELECT 1 FROM enrollments en WHERE en.student_id=$${values.length} AND en.section_id=h.section_id AND en.status='active')`);}
 values.push(query.limit,query.offset);
 return (await pool.query(`${select.replace('FROM homework h',`,${column} FROM homework h`)} WHERE ${filters.join(' AND ')} ORDER BY h.due_on,h.id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function find(user,homeworkId){
 const values=[],column=completionColumn(user,values),filter=scope(user,values);values.push(homeworkId);
 return (await pool.query(`${select.replace('FROM homework h',`,${column} FROM homework h`)} WHERE ${filter} AND h.id=$${values.length}`,values)).rows[0];
}
export async function sectionExists(user,sectionId){return (await pool.query('SELECT id FROM sections WHERE id=$1 AND school_id=$2',[sectionId,user.schoolId])).rows[0];}
// Teachers may post only for subjects they are assigned to teach in that class.
export async function mayTeach(user,sectionId,subjectId){
 if(user.role==='admin')return true;
 return (await pool.query("SELECT 1 FROM sections sec JOIN teacher_assignments a ON a.class_id=sec.class_id AND a.kind='subject_teacher' AND a.subject_id=$3 JOIN teachers t ON t.id=a.teacher_id WHERE sec.id=$1 AND t.user_id=$2 AND t.employment_status='active'",[sectionId,user.id,subjectId])).rowCount>0;
}
export async function raw(homeworkId){return (await pool.query('SELECT id,section_id,subject_id,created_by,archived_at FROM homework WHERE id=$1',[homeworkId])).rows[0];}
export async function create(user,d){
 return (await pool.query('INSERT INTO homework(school_id,section_id,class_id,academic_year_id,subject_id,teacher_id,created_by,title,details,assigned_on,due_on) SELECT sec.school_id,sec.id,sec.class_id,cl.academic_year_id,$2,(SELECT t.id FROM teachers t WHERE t.user_id=$3),$3,$4,$5,coalesce($6::date,CURRENT_DATE),$7 FROM sections sec JOIN classes cl ON cl.id=sec.class_id WHERE sec.id=$1 RETURNING id',[d.section_id,d.subject_id,user.id,d.title,d.details,d.assigned_on??null,d.due_on])).rows[0];
}
export async function update(homeworkId,d){return (await pool.query('UPDATE homework SET title=$2,details=$3,due_on=$4,updated_at=now() WHERE id=$1 AND archived_at IS NULL RETURNING id',[homeworkId,d.title,d.details,d.due_on])).rows[0];}
export async function archive(homeworkId){return (await pool.query('UPDATE homework SET archived_at=coalesce(archived_at,now()),updated_at=now() WHERE id=$1 RETURNING id',[homeworkId])).rows[0];}
export async function complete(user,homeworkId){
 return (await pool.query("INSERT INTO homework_completions(school_id,homework_id,student_id) SELECT h.school_id,h.id,s.id FROM homework h JOIN students s ON s.user_id=$2 JOIN enrollments en ON en.student_id=s.id AND en.section_id=h.section_id AND en.status='active' WHERE h.id=$1 AND h.archived_at IS NULL ON CONFLICT DO NOTHING RETURNING homework_id",[homeworkId,user.id])).rows[0];
}
export async function uncomplete(user,homeworkId){return (await pool.query('DELETE FROM homework_completions WHERE homework_id=$1 AND student_id=(SELECT id FROM students WHERE user_id=$2)',[homeworkId,user.id])).rowCount;}
