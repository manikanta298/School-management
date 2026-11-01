import { z } from 'zod';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;},'Invalid calendar date');
const fields={
 employee_number:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,30}$/),joining_date:date,
 phone:z.string().trim().regex(/^[+0-9() .-]{7,30}$/).nullable().optional().transform(v=>v??null),
 qualification:z.string().trim().max(200).regex(/^[^<>\x00-\x1f]*$/u).nullable().optional().transform(v=>v||null),
 employment_status:z.enum(['active','inactive'])
};
export const create=z.object({user_id:z.uuid(),...fields,employment_status:fields.employment_status.default('active')}).strict();
export const update=z.object(fields).strict();
export const assignment=z.object({class_id:z.uuid(),kind:z.enum(['class_teacher','subject_teacher']),subject_id:z.uuid().nullable().optional().transform(v=>v??null)}).strict().refine(v=>v.kind==='class_teacher'?v.subject_id===null:v.subject_id!==null,{message:'Subject is required only for subject-teacher assignments',path:['subject_id']});
export const id=z.uuid();
const paging={limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).default(0)};
export const listQuery=z.object({...paging,q:z.string().trim().max(100).default(''),academic_year_id:z.uuid().optional(),class_id:z.uuid().optional()}).strict();
export const assignmentQuery=z.object({...paging,academic_year_id:z.uuid().optional(),class_id:z.uuid().optional()}).strict();
export const rosterQuery=z.object({...paging,q:z.string().trim().max(100).default(''),section_id:z.uuid().optional()}).strict();
