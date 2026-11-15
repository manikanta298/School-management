import { pool } from '../config/db.js';
const columns='id,school_id,employee_number,name,staff_type,phone,email,address,joining_date::text AS joining_date,employment_status,created_at,updated_at';
export async function list(schoolId,query){
 const values=[schoolId],filters=['school_id=$1'];
 if(query.q){values.push(query.q);filters.push(`strpos(lower(name || ' ' || employee_number),lower($${values.length}))>0`);}
 for(const field of ['staff_type','employment_status'])if(query[field]){values.push(query[field]);filters.push(`${field}=$${values.length}`);}
 values.push(query.limit,query.offset);
 return (await pool.query(`SELECT ${columns} FROM staff_members WHERE ${filters.join(' AND ')} ORDER BY name,id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function find(schoolId,id){return (await pool.query(`SELECT ${columns} FROM staff_members WHERE school_id=$1 AND id=$2`,[schoolId,id])).rows[0];}
export async function save(schoolId,id,d){
 const values=[schoolId,d.employee_number,d.name,d.staff_type,d.phone,d.email,d.address,d.joining_date,d.employment_status];
 if(id){values.push(id);return (await pool.query('UPDATE staff_members SET employee_number=$2,name=$3,staff_type=$4,phone=$5,email=$6,address=$7,joining_date=$8,employment_status=$9,updated_at=now() WHERE school_id=$1 AND id=$10 RETURNING id',values)).rows[0];}
 return (await pool.query('INSERT INTO staff_members(school_id,employee_number,name,staff_type,phone,email,address,joining_date,employment_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',values)).rows[0];
}
export async function remove(schoolId,id){return (await pool.query('DELETE FROM staff_members WHERE school_id=$1 AND id=$2 RETURNING id',[schoolId,id])).rows[0];}
