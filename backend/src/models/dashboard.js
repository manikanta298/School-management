import * as notices from './notices.js';
import * as fees from './fees.js';
import * as timetable from './timetable.js';
export function studentScope(user,values){if(user.role==='admin')return 'true';values.push(user.id);return user.role==='student'?`s.user_id=$${values.length}`:`EXISTS(SELECT 1 FROM student_parents sp JOIN parents p ON p.id=sp.parent_id WHERE sp.student_id=s.id AND p.user_id=$${values.length})`;}
const attendanceCounts="count(*) FILTER(WHERE ae.status='present')::int AS present,count(*) FILTER(WHERE ae.status='late')::int AS late,count(*) FILTER(WHERE ae.status='absent')::int AS absent,count(*) FILTER(WHERE ae.status='excused')::int AS excused,count(*) FILTER(WHERE ae.status<>'void')::int AS recorded";
export async function read(user,c){
 const calendar=(await c.query("SELECT CURRENT_DATE::text AS today,(CURRENT_DATE-(extract(isodow FROM CURRENT_DATE)::int-1))::text AS week_start,extract(isodow FROM CURRENT_DATE)::int AS weekday,current_setting('TimeZone') AS school_timezone,CURRENT_TIMESTAMP AS generated_at")).rows[0];
 const currentYear=(await c.query('SELECT id,name,start_date,end_date FROM academic_years WHERE is_current=true')).rows[0]||null;
 const response={role:user.role,calendar,current_year:currentYear,stats:{},notices:{unread_count:await notices.unread(user,c),items:await notices.list(user,{limit:5,offset:0,q:'',unread_only:'false'},false,c)},today_sessions:await timetable.list(user,{limit:5,offset:0,week_start:calendar.week_start,weekday:calendar.weekday,include_inactive:'false'},c)};
 if(user.role==='admin'){
 const users=(await c.query('SELECT role,count(*)::int AS total FROM users WHERE active GROUP BY role')).rows;response.stats.active_accounts=Object.fromEntries(users.map(u=>[u.role,u.total]));
 response.stats.profiles=(await c.query("SELECT (SELECT count(*)::int FROM students) AS students,(SELECT count(*)::int FROM parents) AS parents,(SELECT count(*)::int FROM teachers t JOIN users u ON u.id=t.user_id WHERE t.employment_status='active' AND u.active) AS active_teachers")).rows[0];
 response.stats.academic=(await c.query("SELECT (SELECT count(*)::int FROM classes WHERE academic_year_id=$1) AS classes,(SELECT count(*)::int FROM sections s JOIN classes cl ON cl.id=s.class_id WHERE cl.academic_year_id=$1) AS sections,(SELECT count(*)::int FROM enrollments WHERE academic_year_id=$1 AND status='active') AS active_enrollments",[currentYear?.id??null])).rows[0];
 response.attendance_today=(await c.query(`SELECT ${attendanceCounts} FROM attendance_entries ae JOIN attendance_registers ar ON ar.id=ae.register_id WHERE ar.attendance_date=CURRENT_DATE AND ar.academic_year_id=$1`,[currentYear?.id??null])).rows[0];
 response.stats.exams=(await c.query("SELECT count(*) FILTER(WHERE status='draft')::int AS draft,count(*) FILTER(WHERE status='published')::int AS published FROM exams WHERE academic_year_id=$1",[currentYear?.id??null])).rows[0];
 response.stats.notice_management=(await c.query("SELECT count(*) FILTER(WHERE status='draft')::int AS draft,count(*) FILTER(WHERE status='published' AND available_from>CURRENT_TIMESTAMP AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP))::int AS scheduled FROM notices")).rows[0];
 response.fee_balances=await fees.summary(user,{},c);
 }else if(user.role==='teacher'){
 const profile=(await c.query('SELECT id,employment_status FROM teachers WHERE user_id=$1',[user.id])).rows[0];response.profile_state=!profile?'missing':profile.employment_status;
 const assigned="EXISTS(SELECT 1 FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id WHERE a.class_id=cl.id AND t.user_id=$1 AND t.employment_status='active')";
 response.stats.teaching=(await c.query("SELECT count(*)::int AS assignments,count(DISTINCT a.class_id)::int AS classes,count(DISTINCT a.subject_id)::int AS subjects FROM teacher_assignments a JOIN teachers t ON t.id=a.teacher_id WHERE t.user_id=$1 AND t.employment_status='active'",[user.id])).rows[0];
 response.attendance_today=(await c.query(`SELECT ${attendanceCounts} FROM attendance_entries ae JOIN attendance_registers ar ON ar.id=ae.register_id JOIN classes cl ON cl.id=ar.class_id WHERE ar.attendance_date=CURRENT_DATE AND ${assigned}`,[user.id])).rows[0];
 response.stats.exams=(await c.query(`SELECT count(*) FILTER(WHERE e.status='draft')::int AS draft,count(*) FILTER(WHERE e.status='published')::int AS published FROM exams e JOIN classes cl ON cl.id=e.class_id WHERE ${assigned}`,[user.id])).rows[0];
 }else{
 const values=[],access=studentScope(user,values);
 response.stats.family=(await c.query(`SELECT count(*)::int AS students FROM students s WHERE ${access}`,values)).rows[0];
 response.students=(await c.query(`SELECT s.id,s.admission_number,u.name FROM students s JOIN users u ON u.id=s.user_id WHERE ${access} ORDER BY u.name,s.id LIMIT 5`,values)).rows;
 response.stats.family.active_enrollments=(await c.query(`SELECT count(*)::int AS total FROM enrollments en JOIN students s ON s.id=en.student_id WHERE en.status='active' AND ${access}`,values)).rows[0].total;
 response.stats.family.published_exams=(await c.query(`SELECT count(DISTINCT ec.exam_id)::int AS total FROM exam_candidates ec JOIN exams e ON e.id=ec.exam_id JOIN students s ON s.id=ec.student_id WHERE e.status='published' AND ${access}`,values)).rows[0].total;
 response.attendance_today=(await c.query(`SELECT ${attendanceCounts} FROM attendance_entries ae JOIN students s ON s.id=ae.student_id WHERE ae.attendance_date=CURRENT_DATE AND ${access}`,values)).rows[0];
 response.fee_balances=await fees.summary(user,{},c);
 }
 return response;
}
