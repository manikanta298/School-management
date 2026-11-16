import { pool } from '../config/db.js';
import { schoolStudentScope } from './dashboard.js';
const select=`SELECT h.id,h.section_id,h.class_id,h.academic_year_id,h.subject_id,h.title,h.details,h.assigned_on::text AS assigned_on,h.due_on::text AS due_on,h.archived_at,h.created_at,h.updated_at,sub.name AS subject_name,cl.name AS class_name,sec.name AS section_name,u.name AS posted_by FROM homework h JOIN subjects sub ON sub.id=h.subject_id JOIN classes cl ON cl.id=h.class_id JOIN sections sec ON sec.id=h.section_id JOIN users u ON u.id=h.created_by`;
function scope(user,schoolId,values){
 values.push(schoolId);const base=`h.school_id=$${values.length}`;
 if(user.role==='admin')return base;
 values.push(user.id);const b=`$${values.length}`;
 if(user.role==='teacher')return `${base} AND EXISTS(SELECT 1 FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id AND t.school_id=a.school_id WHERE a.school_id=h.school_id AND t.user_id=${b} AND t.employment_status='active' AND a.class_id=h.class_id)`;
 const family=user.role==='student'?`s.user_id=${b}`:`EXISTS(SELECT 1 FROM student_parents sp JOIN parents p ON p.id=sp.parent_id AND p.school_id=sp.school_id WHERE sp.student_id=s.id AND sp.school_id=s.school_id AND p.user_id=${b})`;
 return `${base} AND h.archived_at IS NULL AND EXISTS(SELECT 1 FROM enrollments en JOIN students s ON s.id=en.student_id AND s.school_id=en.school_id WHERE en.school_id=h.school_id AND en.section_id=h.section_id AND en.status='active' AND ${family})`;
}
function completionColumn(user,schoolId,values){
 if(user.role==='admin'||user.role==='teacher')return '(SELECT count(*)::int FROM homework_completions c WHERE c.homework_id=h.id) AS completion_count';
 return `coalesce((SELECT array_agg(c.student_id) FROM homework_completions c JOIN students s ON s.id=c.student_id WHERE c.homework_id=h.id AND c.school_id=h.school_id AND ${schoolStudentScope(user,schoolId,values)}),'{}') AS completed_student_ids`;
}
export async function list(user,schoolId,query){
 const values=[],column=completionColumn(user,schoolId,values),filters=[scope(user,schoolId,values)];
 if(query.include_archived!=='true'||!['admin','teacher'].includes(user.role))filters.push('h.archived_at IS NULL');
 for(const [key,col] of [['section_id','h.section_id'],['subject_id','h.subject_id']])if(query[key]){values.push(query[key]);filters.push(`${col}=$${values.length}`);}
 if(query.due_from){values.push(query.due_from);filters.push(`h.due_on>=$${values.length}`);}
 if(query.due_to){values.push(query.due_to);filters.push(`h.due_on<=$${values.length}`);}
 if(query.student_id){values.push(query.student_id);filters.push(`EXISTS(SELECT 1 FROM enrollments en WHERE en.school_id=h.school_id AND en.student_id=$${values.length} AND en.section_id=h.section_id AND en.status='active')`);}
 values.push(query.limit,query.offset);
 return (await pool.query(`${select.replace('FROM homework h',`,${column} FROM homework h`)} WHERE ${filters.join(' AND ')} ORDER BY h.due_on,h.id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function find(user,schoolId,homeworkId){
 const values=[],column=completionColumn(user,schoolId,values),filter=scope(user,schoolId,values);values.push(homeworkId);
 return (await pool.query(`${select.replace('FROM homework h',`,${column} FROM homework h`)} WHERE ${filter} AND h.id=$${values.length}`,values)).rows[0];
}
export async function sectionExists(schoolId,sectionId){return (await pool.query('SELECT id FROM sections WHERE id=$1 AND school_id=$2',[sectionId,schoolId])).rows[0];}
// Teachers may post only for subjects they are assigned to teach in that class.
export async function mayTeach(user,schoolId,sectionId,subjectId){
 if(user.role==='admin')return true;
 return (await pool.query("SELECT 1 FROM sections sec JOIN teacher_assignments a ON a.class_id=sec.class_id AND a.kind='subject_teacher' AND a.subject_id=$3 JOIN teachers t ON t.id=a.teacher_id AND t.school_id=a.school_id WHERE sec.id=$1 AND sec.school_id=$4 AND a.school_id=sec.school_id AND t.user_id=$2 AND t.employment_status='active'",[sectionId,user.id,subjectId,schoolId])).rowCount>0;
}
export async function raw(schoolId,homeworkId){return (await pool.query('SELECT id,section_id,subject_id,created_by,archived_at FROM homework WHERE id=$1 AND school_id=$2',[homeworkId,schoolId])).rows[0];}
export async function create(user,schoolId,d){
 return (await pool.query('INSERT INTO homework(school_id,section_id,class_id,academic_year_id,subject_id,teacher_id,created_by,title,details,assigned_on,due_on) SELECT sec.school_id,sec.id,sec.class_id,cl.academic_year_id,$2,(SELECT t.id FROM teachers t WHERE t.user_id=$3 AND t.school_id=$8),$3,$4,$5,coalesce($6::date,CURRENT_DATE),$7 FROM sections sec JOIN classes cl ON cl.id=sec.class_id AND cl.school_id=sec.school_id WHERE sec.id=$1 AND sec.school_id=$8 RETURNING id',[d.section_id,d.subject_id,user.id,d.title,d.details,d.assigned_on??null,d.due_on,schoolId])).rows[0];
}
export async function update(schoolId,homeworkId,d){return (await pool.query('UPDATE homework SET title=$2,details=$3,due_on=$4,updated_at=now() WHERE id=$1 AND school_id=$5 AND archived_at IS NULL RETURNING id',[homeworkId,d.title,d.details,d.due_on,schoolId])).rows[0];}
export async function archive(schoolId,homeworkId){return (await pool.query('UPDATE homework SET archived_at=coalesce(archived_at,now()),updated_at=now() WHERE id=$1 AND school_id=$2 RETURNING id',[homeworkId,schoolId])).rows[0];}
export async function complete(user,schoolId,homeworkId){
 return (await pool.query("INSERT INTO homework_completions(school_id,homework_id,student_id) SELECT h.school_id,h.id,s.id FROM homework h JOIN students s ON s.user_id=$2 AND s.school_id=h.school_id JOIN enrollments en ON en.student_id=s.id AND en.school_id=h.school_id AND en.section_id=h.section_id AND en.status='active' WHERE h.id=$1 AND h.school_id=$3 AND h.archived_at IS NULL ON CONFLICT DO NOTHING RETURNING homework_id",[homeworkId,user.id,schoolId])).rows[0];
}
export async function uncomplete(user,schoolId,homeworkId){return (await pool.query('DELETE FROM homework_completions WHERE homework_id=$1 AND school_id=$3 AND student_id=(SELECT id FROM students WHERE user_id=$2 AND school_id=$3)',[homeworkId,user.id,schoolId])).rowCount;}
