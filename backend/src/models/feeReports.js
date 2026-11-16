import { pool } from '../config/db.js';
const groups={
 day:{expr:"to_char(p.paid_on,'YYYY-MM-DD')",joins:''},
 month:{expr:"to_char(p.paid_on,'YYYY-MM')",joins:''},
 method:{expr:'p.method',joins:''},
 class:{expr:'cl.name',joins:' JOIN classes cl ON cl.id=i.class_id AND cl.school_id=i.school_id'},
 category:{expr:'f.category',joins:' JOIN fee_structures f ON f.id=i.fee_structure_id AND f.school_id=i.school_id'}
};
export const groupNames=Object.keys(groups);
export async function collection(schoolId,query){
 const group=groups[query.group_by];
 return (await pool.query(`SELECT ${group.expr} AS key,i.currency,sum(p.amount_minor)::text AS collected_minor,count(*)::int AS payments FROM fee_payments p JOIN fee_invoices i ON i.id=p.invoice_id AND i.school_id=p.school_id${group.joins} WHERE p.school_id=$3 AND p.reversed_at IS NULL AND p.paid_on BETWEEN coalesce($1::date,date_trunc('month',CURRENT_DATE)::date) AND coalesce($2::date,CURRENT_DATE) GROUP BY 1,2 ORDER BY 1,2`,[query.from??null,query.to??null,schoolId])).rows;
}
export async function defaulters(schoolId,query){
 return (await pool.query(`SELECT s.id AS student_id,u.name,s.admission_number,i.currency,sum(i.amount_minor-paid.total)::text AS outstanding_minor,min(i.due_on)::text AS oldest_due_on,count(*)::int AS invoices
 FROM fee_invoices i JOIN students s ON s.id=i.student_id JOIN users u ON u.id=s.user_id
 CROSS JOIN LATERAL (SELECT coalesce(sum(p.amount_minor),0) AS total FROM fee_payments p WHERE p.invoice_id=i.id AND p.reversed_at IS NULL) paid
 WHERE i.school_id=$3 AND i.voided_at IS NULL AND i.due_on<CURRENT_DATE AND i.amount_minor>paid.total
 GROUP BY s.id,u.name,s.admission_number,i.currency ORDER BY min(i.due_on),u.name,s.id LIMIT $1 OFFSET $2`,[query.limit,query.offset,schoolId])).rows;
}
