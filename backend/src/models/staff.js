import { pool } from '../config/db.js';
const columns='id,employee_number,name,staff_type,phone,email,address,joining_date::text AS joining_date,employment_status,created_at,updated_at';
export async function list(query){
 const values=[],filters=['true'];
 if(query.q){values.push(query.q);filters.push(`strpos(lower(name || ' ' || employee_number),lower($${values.length}))>0`);}
 for(const field of ['staff_type','employment_status'])if(query[field]){values.push(query[field]);filters.push(`${field}=$${values.length}`);}
 values.push(query.limit,query.offset);
 return (await pool.query(`SELECT ${columns} FROM staff_members WHERE ${filters.join(' AND ')} ORDER BY name,id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function find(id){return (await pool.query(`SELECT ${columns} FROM staff_members WHERE id=$1`,[id])).rows[0];}
export async function save(id,d){
 const values=[d.employee_number,d.name,d.staff_type,d.phone,d.email,d.address,d.joining_date,d.employment_status];
 if(id){values.push(id);return (await pool.query('UPDATE staff_members SET employee_number=$1,name=$2,staff_type=$3,phone=$4,email=$5,address=$6,joining_date=$7,employment_status=$8,updated_at=now() WHERE id=$9 RETURNING id',values)).rows[0];}
 return (await pool.query('INSERT INTO staff_members(employee_number,name,staff_type,phone,email,address,joining_date,employment_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',values)).rows[0];
}
export async function remove(id){return (await pool.query('DELETE FROM staff_members WHERE id=$1 RETURNING id',[id])).rows[0];}
