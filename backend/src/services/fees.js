import { pool } from '../config/db.js';
import * as model from '../models/fees.js';
import { fail } from './auth.js';
export const list=model.list,summary=model.summary,structures=model.structures;
export async function find(user,id,client=pool){const result=await model.find(user,id,client);if(!result)throw fail(404,'Invoice not found');return result;}
export async function saveStructure(id,data){const result=await model.saveStructure(id,data);if(!result)throw fail(404,'Fee structure not found');return result;}
export async function create(user,data){const result=await model.createInvoice(user,data);if(!result)throw fail(400,'Choose an active fee structure and matching active enrollment');return find(user,result.id);}
export async function payments(user,id,query){await find(user,id);return model.payments(user,id,query);}
export async function events(user,id,query){await find(user,id);return model.events(id,query);}
async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function adminActor(c,user){const {rows:[actor]}=await c.query('SELECT role,active FROM users WHERE id=$1 FOR SHARE',[user.id]);if(!actor?.active||actor.role!=='admin')throw fail(403,'Active administrator required');}
export async function pay(user,id,data){return transaction(async c=>{
 await adminActor(c,user);
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[data.idempotency_key]);
 await c.query('SELECT id FROM fee_invoices WHERE id=$1 FOR UPDATE',[id]);await find(user,id,c);
 const {rows:[existing]}=await c.query('SELECT * FROM fee_payments WHERE idempotency_key=$1',[data.idempotency_key]);
 if(existing){const date=existing.paid_on instanceof Date?existing.paid_on.toISOString().slice(0,10):String(existing.paid_on).slice(0,10);if(existing.invoice_id!==id||existing.amount_minor!==data.amount_minor||date!==data.paid_on||existing.method!==data.method||existing.reference!==data.reference)throw fail(409,'Payment retry key was already used for different payment details');return {payment_id:existing.id,receipt_number:existing.receipt_number,replayed:true};}
 const {rows:[payment]}=await c.query('INSERT INTO fee_payments(invoice_id,amount_minor,paid_on,method,reference,idempotency_key,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,receipt_number',[id,data.amount_minor,data.paid_on,data.method,data.reference,data.idempotency_key,user.id]);
 return {payment_id:payment.id,receipt_number:payment.receipt_number,replayed:false};
 });}
export async function reverse(user,invoiceId,paymentId,reason){return transaction(async c=>{await adminActor(c,user);await c.query('SELECT id FROM fee_invoices WHERE id=$1 FOR UPDATE',[invoiceId]);await find(user,invoiceId,c);const result=await c.query('UPDATE fee_payments SET reversed_at=now(),reversal_reason=$1,reversed_by=$2 WHERE id=$3 AND invoice_id=$4 AND reversed_at IS NULL RETURNING id',[reason,user.id,paymentId,invoiceId]);if(!result.rows[0])throw fail(409,'Payment not found in this invoice or already reversed');});}
export async function voidInvoice(user,id,reason){return transaction(async c=>{await adminActor(c,user);await c.query('SELECT id FROM fee_invoices WHERE id=$1 FOR UPDATE',[id]);await find(user,id,c);const result=await c.query('UPDATE fee_invoices SET voided_at=now(),void_reason=$1,voided_by=$2 WHERE id=$3 AND voided_at IS NULL RETURNING id',[reason,user.id,id]);if(!result.rows[0])throw fail(409,'Invoice already void');});}

export async function calendar(){return (await pool.query('SELECT CURRENT_DATE::text AS today')).rows[0];}
