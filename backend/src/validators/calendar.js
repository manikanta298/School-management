import { z } from 'zod';
export const id=z.uuid();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;},'Invalid calendar date');
const plain=max=>z.string().trim().max(max).regex(/^[^<>\x00-\x08\x0b\x0c\x0e-\x1f]*$/u);
export const event=z.object({title:plain(150).min(1),description:plain(1000).nullable().optional().transform(v=>v||null),event_type:z.enum(['holiday','event','exam','meeting']),starts_on:date,ends_on:date.optional()}).strict().transform(v=>({...v,ends_on:v.ends_on??v.starts_on})).refine(v=>v.ends_on>=v.starts_on,{message:'End date cannot precede the start date',path:['ends_on']});
export const listQuery=z.object({from:date.optional(),to:date.optional(),event_type:z.enum(['holiday','event','exam','meeting']).optional(),limit:z.coerce.number().int().min(1).max(200).default(100)}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,{message:'Range must be ordered',path:['to']});
