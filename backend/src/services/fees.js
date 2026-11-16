import { pool } from '../config/db.js';
import * as model from '../models/fees.js';
import { fail } from './auth.js';
export const list=model.list,summary=model.summary,structures=model.structures;
export async function find(user,schoolId,id,client=pool){const result=await model.find(user,schoolId,id,client);if(!result)throw fail(404,'Invoice not found');return result;}
export async function saveStructure(schoolId,id,data){const result=await model.saveStructure(schoolId,id,data);if(!result)throw fail(404,'Fee structure or class not found');return result;}
export async function create(user,schoolId,data){const result=await model.createInvoice(user,schoolId,data);if(!result)throw fail(400,'Choose an active fee structure and matching active enrollment');return find(user,schoolId,result.id);}
export async function payments(user,schoolId,id,query){await find(user,schoolId,id);return model.payments(user,schoolId,id,query);}
export async function events(user,schoolId,id,query){await find(user,schoolId,id);return model.events(schoolId,id,query);}
async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function adminActor(c,user,schoolId){const {rows:[actor]}=await c.query('SELECT m.role,m.status,u.active FROM users u JOIN school_memberships m ON m.user_id=u.id AND m.school_id=$2 WHERE u.id=$1 FOR SHARE OF u,m',[user.id,schoolId]);if(!actor?.active||actor.status!=='active'||actor.role!=='admin')throw fail(403,'Active administrator required');}
export async function pay(user,schoolId,id,data){return transaction(async c=>{
 await adminActor(c,user,schoolId);
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[schoolId+':'+data.idempotency_key]);
 await find(user,schoolId,id,c);await c.query('SELECT id FROM fee_invoices WHERE id=$1 AND school_id=$2 FOR UPDATE',[id,schoolId]);
 const {rows:[existing]}=await c.query('SELECT * FROM fee_payments WHERE idempotency_key=$1 AND school_id=$2',[data.idempotency_key,schoolId]);
 if(existing){const date=existing.paid_on instanceof Date?existing.paid_on.toISOString().slice(0,10):String(existing.paid_on).slice(0,10);if(existing.invoice_id!==id||existing.amount_minor!==data.amount_minor||date!==data.paid_on||existing.method!==data.method||existing.reference!==data.reference)throw fail(409,'Payment retry key was already used for different payment details');return {payment_id:existing.id,receipt_number:existing.receipt_number,replayed:true};}
 const {rows:[payment]}=await c.query('INSERT INTO fee_payments(school_id,invoice_id,amount_minor,paid_on,method,reference,idempotency_key,recorded_by) VALUES($8,$1,$2,$3,$4,$5,$6,$7) RETURNING id,receipt_number',[id,data.amount_minor,data.paid_on,data.method,data.reference,data.idempotency_key,user.id,schoolId]);
 return {payment_id:payment.id,receipt_number:payment.receipt_number,replayed:false};
 });}
export async function reverse(user,schoolId,invoiceId,paymentId,reason){return transaction(async c=>{await adminActor(c,user,schoolId);await find(user,schoolId,invoiceId,c);await c.query('SELECT id FROM fee_invoices WHERE id=$1 AND school_id=$2 FOR UPDATE',[invoiceId,schoolId]);const result=await c.query('UPDATE fee_payments SET reversed_at=now(),reversal_reason=$1,reversed_by=$2 WHERE id=$3 AND invoice_id=$4 AND school_id=$5 AND reversed_at IS NULL RETURNING id',[reason,user.id,paymentId,invoiceId,schoolId]);if(!result.rows[0])throw fail(409,'Payment not found in this invoice or already reversed');});}
export async function voidInvoice(user,schoolId,id,reason){return transaction(async c=>{await adminActor(c,user,schoolId);await find(user,schoolId,id,c);await c.query('SELECT id FROM fee_invoices WHERE id=$1 AND school_id=$2 FOR UPDATE',[id,schoolId]);const result=await c.query('UPDATE fee_invoices SET voided_at=now(),void_reason=$1,voided_by=$2 WHERE id=$3 AND school_id=$4 AND voided_at IS NULL RETURNING id',[reason,user.id,id,schoolId]);if(!result.rows[0])throw fail(409,'Invoice already void');});}

export async function calendar(){return (await pool.query('SELECT CURRENT_DATE::text AS today')).rows[0];}
