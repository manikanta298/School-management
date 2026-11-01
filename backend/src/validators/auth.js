import { z } from 'zod';
export const password = z.string().min(12).refine(v=>Buffer.byteLength(v,'utf8')<=72,'Password must be at most 72 UTF-8 bytes');
const email = z.string().trim().toLowerCase().email().max(254);
export const login = z.object({email,password:z.string().min(1).max(200)}).strict();
export const createUser = z.object({name:z.string().trim().min(1).max(100).regex(/^[^<>\x00-\x1f]+$/u),email,password,role:z.enum(['admin','teacher','student','parent'])}).strict();
export const changePassword = z.object({currentPassword:z.string().min(1).max(200),newPassword:password}).strict();
export const resetPassword = z.object({newPassword:password}).strict();
export function validate(schema) {return (req,res,next)=>{const parsed=schema.safeParse(req.body);if(!parsed.success) return res.status(400).json({message:'Invalid input',errors:parsed.error.flatten().fieldErrors});req.body=parsed.data;next();};}
