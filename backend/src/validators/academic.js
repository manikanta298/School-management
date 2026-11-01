import { z } from 'zod';
const name=z.string().trim().min(1).max(100).regex(/^[^<>\x00-\x1f]+$/u);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;},'Invalid calendar date');
const dates=s=>s.refine(v=>v.end_date>=v.start_date,{message:'End date must follow start date',path:['end_date']});
export const schemas={
 'academic-years':dates(z.object({name,start_date:date,end_date:date,is_current:z.boolean().default(false)}).strict()),
 terms:dates(z.object({name,academic_year_id:z.uuid(),start_date:date,end_date:date}).strict()),
 classes:z.object({name,academic_year_id:z.uuid()}).strict(),
 sections:z.object({name,class_id:z.uuid(),capacity:z.number().int().min(1).max(500)}).strict(),
 subjects:z.object({name,code:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/)}).strict()
};
export const identifier=z.uuid();
export const pagination=z.object({limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).default(0),academic_year_id:z.uuid().optional(),class_id:z.uuid().optional()}).strict();
