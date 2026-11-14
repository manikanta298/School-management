import { z } from 'zod';
const plain=max=>z.string().trim().max(max).regex(/^[^<>\x00-\x08\x0b\x0c\x0e-\x1f]*$/u);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;},'Invalid calendar date');
const types=['accountant','receptionist','administrative','transport','librarian','attender','security'];
export const staffBody=z.object({
 employee_number:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,30}$/),
 name:plain(100).min(1),
 staff_type:z.enum(types),
 phone:z.string().trim().regex(/^[+0-9() .-]{7,30}$/).nullable().optional().transform(v=>v??null),
 email:z.email().max(254).transform(v=>v.toLowerCase()).nullable().optional().transform(v=>v??null),
 address:plain(500).nullable().optional().transform(v=>v||null),
 joining_date:date,
 employment_status:z.enum(['active','inactive']).default('active')
}).strict();
export const id=z.uuid();
export const listQuery=z.object({limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).default(0),q:z.string().trim().max(100).default(''),staff_type:z.enum(types).optional(),employment_status:z.enum(['active','inactive']).optional()}).strict();
