import { z } from 'zod';
export const id=z.uuid();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;},'Invalid calendar date');
const title=z.string().trim().min(1).max(150).regex(/^[^<>\x00-\x1f]*$/u);
const details=z.string().trim().min(1).max(5000).regex(/^[^<>\x00-\x08\x0b\x0c\x0e-\x1f]*$/u);
export const create=z.object({section_id:id,subject_id:id,title,details,assigned_on:date.optional(),due_on:date}).strict();
export const update=z.object({title,details,due_on:date}).strict();
export const listQuery=z.object({limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).default(0),section_id:id.optional(),subject_id:id.optional(),student_id:id.optional(),include_archived:z.enum(['true','false']).default('false'),due_from:date.optional(),due_to:date.optional()}).strict();
