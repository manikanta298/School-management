import {randomBytes,randomUUID} from 'node:crypto';
import bcrypt from 'bcrypt';
import {pool} from '../config/db.js';
export const DEMO_YEAR_ID='d36a2026-1102-4000-8000-000000000001';
export async function demoStatus(){return {loaded:!!(await pool.query('SELECT id FROM academic_years WHERE id=$1',[DEMO_YEAR_ID])).rowCount};}
export async function seedDemo(actor){
 const c=await pool.connect();
 const insert=async(sql,args=[])=>{const r=await c.query(sql+' RETURNING id',args);return r.rows[0].id;};
 try{
  await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(7182027)');
  if((await c.query('SELECT id FROM academic_years WHERE id=$1',[DEMO_YEAR_ID])).rowCount){await c.query('COMMIT');return {created:false,message:'Demo content already exists; existing records were not changed.'};}
  // A random, discarded password hash means demo profiles do not add public test logins.
  const hash=await bcrypt.hash(randomBytes(32).toString('hex'),12);
  const account=(name,role,key)=>insert('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)',['Demo · '+name,`demo.${key}@example.invalid`,hash,role]);
  const current=!(await c.query('SELECT id FROM academic_years WHERE is_current=true')).rowCount;
  await c.query("INSERT INTO academic_years(id,name,start_date,end_date,is_current) VALUES($1,'DEMO · School year 2026–27',CURRENT_DATE-120,CURRENT_DATE+240,$2)",[DEMO_YEAR_ID,current]);
  const term1=await insert("INSERT INTO terms(academic_year_id,name,start_date,end_date) VALUES($1,'DEMO · Term 1',CURRENT_DATE-120,CURRENT_DATE-1)",[DEMO_YEAR_ID]);
  const term2=await insert("INSERT INTO terms(academic_year_id,name,start_date,end_date) VALUES($1,'DEMO · Term 2',CURRENT_DATE,CURRENT_DATE+240)",[DEMO_YEAR_ID]);
  const classes=[],sections=[],rooms=[];
  for(let i=0;i<2;i++){
   classes.push(await insert('INSERT INTO classes(academic_year_id,name) VALUES($1,$2)',[DEMO_YEAR_ID,`DEMO · Class ${8+i}`]));
   sections.push(await insert("INSERT INTO sections(class_id,name,capacity) VALUES($1,'A',40)",[classes[i]]));
   rooms.push(await insert('INSERT INTO school_rooms(name,location) VALUES($1,$2)',[`DEMO · Room ${101+i}`,'Demonstration campus · Main building']));
  }
  const subjects=[];for(const [name,code] of [['Mathematics','MATH'],['Science','SCI'],['English','ENG']])subjects.push(await insert('INSERT INTO subjects(name,code) VALUES($1,$2)',['DEMO · '+name,'DEMO-'+code]));
  const teachers=[],teacherUsers=[];
  for(const [i,name] of ['Meera Iyer','Arjun Nair','Sara Khan'].entries()){
   const u=await account(name,'teacher',`teacher${i+1}`);teacherUsers.push(u);
   teachers.push(await insert("INSERT INTO teachers(user_id,employee_number,joining_date,qualification) VALUES($1,$2,CURRENT_DATE-365,'M.Ed. · Demonstration staff profile')",[u,`DEMO-T${i+1}`]));
  }
  const assignments=[];
  for(let cl=0;cl<2;cl++){
   await insert("INSERT INTO teacher_assignments(teacher_id,class_id,academic_year_id,kind) VALUES($1,$2,$3,'class_teacher')",[teachers[cl],classes[cl],DEMO_YEAR_ID]);
   assignments[cl]=[];
   for(let sub=0;sub<3;sub++){
    assignments[cl][sub]=await insert("INSERT INTO teacher_assignments(teacher_id,class_id,academic_year_id,kind,subject_id) VALUES($1,$2,$3,'subject_teacher',$4)",[teachers[sub],classes[cl],DEMO_YEAR_ID,subjects[sub]]);
    for(let day=1;day<=5;day++)await insert('INSERT INTO timetable_slots(section_id,class_id,academic_year_id,assignment_id,teacher_id,subject_id,room_id,weekday,start_minute,end_minute,effective_from,effective_to,created_by,changed_by,change_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_DATE-120,CURRENT_DATE+240,$11,$11,$12)',[sections[cl],classes[cl],DEMO_YEAR_ID,assignments[cl][sub],teachers[sub],subjects[sub],rooms[cl],day,540+cl*240+sub*60,585+cl*240+sub*60,actor,'DEMO · Weekly teaching schedule']);
   }
  }
  const parentNames=['Priya Sharma','Neha Patel','Kiran Reddy','Lakshmi Rao','Meera Singh','Ravi Nair','Anita Iyer','Sanjay Das'];
  const parents=[],parentUsers=[];for(const [i,name] of parentNames.entries()){const u=await account(name,'parent',`parent${i+1}`);parentUsers.push(u);parents.push(await insert("INSERT INTO parents(user_id,address) VALUES($1,'DEMO · Fictional residence; no real personal contact data')",[u]));}
  const names=['Aarav Sharma','Diya Patel','Ishaan Reddy','Ananya Rao','Kabir Singh','Riya Nair','Vivaan Iyer','Saanvi Das','Arjun Sharma','Aadhya Patel','Reyansh Reddy','Kiara Rao','Aditya Singh','Myra Nair','Krishna Iyer','Ira Das'];
  const students=[],enrollments=[],studentUsers=[];
  for(const [i,name] of names.entries()){
   const u=await account(name,'student',`student${i+1}`);studentUsers.push(u);
   students.push(await insert("INSERT INTO students(user_id,admission_number,admission_date,date_of_birth,address) VALUES($1,$2,CURRENT_DATE-130,CURRENT_DATE-interval '13 years','DEMO · Fictional student profile')",[u,`DEMO-S${String(i+1).padStart(3,'0')}`]));
   const cl=i%2;
   enrollments.push(await insert('INSERT INTO enrollments(student_id,academic_year_id,class_id,section_id,enrolled_on) VALUES($1,$2,$3,$4,CURRENT_DATE-120)',[students[i],DEMO_YEAR_ID,classes[cl],sections[cl]]));
   await c.query("INSERT INTO student_parents(student_id,parent_id,relationship) VALUES($1,$2,'guardian')",[students[i],parents[Math.floor(i/2)]]);
  }
  let correctedEntry;
  const schoolDays=(await c.query("SELECT day_offset FROM generate_series(0,10) AS day_offset WHERE extract(isodow FROM CURRENT_DATE-day_offset)<=5 ORDER BY day_offset LIMIT 5")).rows.map(r=>r.day_offset).reverse();
  for(const days of schoolDays)for(let cl=0;cl<2;cl++){ 
   const register=await insert('INSERT INTO attendance_registers(section_id,class_id,academic_year_id,attendance_date,created_by) VALUES($1,$2,$3,CURRENT_DATE-$4::int,$5)',[sections[cl],classes[cl],DEMO_YEAR_ID,days,actor]);
   for(let i=cl;i<students.length;i+=2){const status=(i+days)%11===0?'absent':(i+days)%7===0?'late':(i+days)%13===0?'excused':'present';const entry=await insert('INSERT INTO attendance_entries(register_id,attendance_date,student_id,enrollment_id,status,note,updated_by) VALUES($1,CURRENT_DATE-$2::int,$3,$4,$5,$6,$7)',[register,days,students[i],enrollments[i],status,'DEMO · Attendance example',actor]);if(days===schoolDays.at(-1)&&i===0)correctedEntry=entry;}
  }
  await c.query("UPDATE attendance_entries SET status='present',change_reason='DEMO · Verified classroom attendance',updated_by=$1 WHERE id=$2",[actor,correctedEntry]);
  const fees=[];for(let cl=0;cl<2;cl++)fees.push(await insert("INSERT INTO fee_structures(class_id,academic_year_id,name,amount_minor,currency) VALUES($1,$2,'DEMO · Term tuition',850000,'INR')",[classes[cl],DEMO_YEAR_ID]));
  let invoiceCount=0,paymentCount=0;
  for(let i=0;i<students.length;i++){
   const cl=i%2,inv=await insert("INSERT INTO fee_invoices(student_id,fee_structure_id,enrollment_id,class_id,academic_year_id,title,amount_minor,currency,issued_on,due_on,created_by) VALUES($1,$2,$3,$4,$5,'DEMO · Term tuition',850000,'INR',CURRENT_DATE-14,CURRENT_DATE+$6::int,$7)",[students[i],fees[cl],enrollments[i],classes[cl],DEMO_YEAR_ID,i%3===0?-3:14,actor]);invoiceCount++;
   if(i%3!==0){await insert("INSERT INTO fee_payments(invoice_id,amount_minor,paid_on,method,reference,idempotency_key,recorded_by) VALUES($1,$2,CURRENT_DATE-7,'bank_transfer',$3,$4,$5)",[inv,i%3===1?850000:425000,`DEMO-TRANSFER-${i+1}`,randomUUID(),actor]);paymentCount++;}
  }
  // A separate USD example demonstrates that currencies are never added together.
  const usd=await insert("INSERT INTO fee_structures(class_id,academic_year_id,name,amount_minor,currency) VALUES($1,$2,'DEMO · International resources',12500,'USD')",[classes[0],DEMO_YEAR_ID]);
  await insert("INSERT INTO fee_invoices(student_id,fee_structure_id,enrollment_id,class_id,academic_year_id,title,amount_minor,currency,issued_on,due_on,created_by) VALUES($1,$2,$3,$4,$5,'DEMO · International resources',12500,'USD',CURRENT_DATE-14,CURRENT_DATE-2,$6)",[students[0],usd,enrollments[0],classes[0],DEMO_YEAR_ID,actor]);invoiceCount++;
  const scale=await insert("INSERT INTO exam_grading_scales(name) VALUES('DEMO · Standard grades')");
  for(const [min,label] of [[90,'A+'],[80,'A'],[70,'B'],[60,'C'],[40,'D'],[0,'F']])await c.query('INSERT INTO exam_grade_bands(scale_id,minimum_percent,label) VALUES($1,$2,$3)',[scale,min,label]);
  for(let cl=0;cl<2;cl++){
   const exam=await insert("INSERT INTO exams(class_id,academic_year_id,term_id,grading_scale_id,name,start_date,end_date,created_by,updated_by) VALUES($1,$2,$3,$4,'DEMO · Term 1 assessment',CURRENT_DATE-20,CURRENT_DATE-18,$5,$5)",[classes[cl],DEMO_YEAR_ID,term1,scale,actor]);
   for(let i=cl;i<students.length;i+=2)await c.query('INSERT INTO exam_candidates(exam_id,student_id,enrollment_id,section_id,class_id) VALUES($1,$2,$3,$4,$5)',[exam,students[i],enrollments[i],sections[cl],classes[cl]]);
   for(let sub=0;sub<3;sub++){
    const paper=await insert('INSERT INTO exam_papers(exam_id,subject_id,held_on,max_marks,pass_marks) VALUES($1,$2,CURRENT_DATE-20+$3::int,100,40)',[exam,subjects[sub],sub]);
    for(let i=cl;i<students.length;i+=2)await insert("INSERT INTO exam_marks(exam_id,paper_id,student_id,outcome,score,remark,updated_by) VALUES($1,$2,$3,'scored',$4,'DEMO · Practice assessment',$5)",[exam,paper,students[i],55+((i*7+sub*11)%43),actor]);
   }
   await c.query("UPDATE exams SET status='published',updated_by=$1 WHERE id=$2",[actor,exam]);
   await insert("INSERT INTO exams(class_id,academic_year_id,term_id,grading_scale_id,name,start_date,end_date,created_by,updated_by) VALUES($1,$2,$3,$4,'DEMO · Upcoming unit test',CURRENT_DATE+15,CURRENT_DATE+17,$5,$5)",[classes[cl],DEMO_YEAR_ID,term2,scale,actor]);
  }
  let firstNotice;
  const announcements=[['Parent–teacher meeting','Please join class teachers for a discussion of your child’s progress. This announcement is demonstration content.','parent','important','live'],['Term 1 report cards published','Open Exams & Results to explore the fictional report cards.','all','normal','live'],['Teacher planning session','Staff are invited to review teaching plans and timetable coverage. Demonstration notice.','teacher','normal','live'],['Library reading week','Students can prepare a short review of their favourite book. Demonstration activity.','student','normal','live'],['Science exhibition registration','Registration opens next week. Demonstration schedule.','all','important','scheduled'],['School excursion planning','Draft announcement for the upcoming fictional school excursion.','all','normal','draft']];
  for(const [title,body,audience,priority,state] of announcements){
   const id=await insert("INSERT INTO notices(title,body,audience,priority,available_from,created_by,updated_by) VALUES($1,$2,$3,$4,now()+($5::int*interval '1 day'),$6,$6)",['DEMO · '+title,'DEMO CONTENT — '+body,audience,priority,state==='scheduled'?7:-1,actor]);
   if(state!=='draft')await c.query("UPDATE notices SET status='published',version=version+1,updated_by=$1 WHERE id=$2",[actor,id]);
   if(audience==='all'&&state==='live')firstNotice=id;
  }
  for(const u of [studentUsers[0],parentUsers[0],teacherUsers[0]])await c.query('INSERT INTO notice_reads(notice_id,user_id,content_revision) VALUES($1,$2,1)',[firstNotice,u]);
  await c.query('COMMIT');return {created:true,year_id:DEMO_YEAR_ID,is_current:current,counts:{students:16,parents:8,teachers:3,classes:2,sections:2,subjects:3,terms:2,rooms:2,timetable_sessions:30,attendance_entries:80,fee_structures:3,invoices:invoiceCount,payments:paymentCount,exams:4,papers:6,marks:48,notices:6},message:'Demonstration content created. All demo profiles and records are labeled; no existing records were changed.'};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
