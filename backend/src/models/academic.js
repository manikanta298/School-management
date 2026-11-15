import { pool } from '../config/db.js';
// SQL identifiers come exclusively from this static allowlist, never request text.
export const resources={
 'academic-years':{table:'academic_years',fields:['name','start_date','end_date','is_current']},
 terms:{table:'terms',fields:['name','academic_year_id','start_date','end_date'],parent:'academic_year_id'},
 classes:{table:'classes',fields:['name','academic_year_id'],parent:'academic_year_id'},
 sections:{table:'sections',fields:['name','class_id','capacity'],parent:'class_id'},
 subjects:{table:'subjects',fields:['name','code']}
};
export async function list(resource,query,schoolId){
 const {table,parent}=resources[resource];
 const values=[schoolId],filters=['school_id=$1'];
 if(parent && query[parent]){values.push(query[parent]);filters.push(`${parent}=$${values.length}`);}
 values.push(query.limit,query.offset);
 return (await pool.query(`SELECT * FROM ${table} WHERE ${filters.join(' AND ')} ORDER BY name,id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function find(resource,id,schoolId){return (await pool.query(`SELECT * FROM ${resources[resource].table} WHERE id=$1 AND school_id=$2`,[id,schoolId])).rows[0];}
export async function save(resource,id,data,schoolId){
 const {table,fields}=resources[resource];const values=fields.map(f=>data[f]);
 if(id){values.push(id,schoolId);return (await pool.query(`UPDATE ${table} SET ${fields.map((f,i)=>`${f}=$${i+1}`).join(',')} WHERE id=$${values.length-1} AND school_id=$${values.length} RETURNING *`,values)).rows[0];}
 values.push(schoolId);
 return (await pool.query(`INSERT INTO ${table}(${[...fields,'school_id'].join(',')}) VALUES(${fields.map((_,i)=>`$${i+1}`).concat(`$${values.length}`).join(',')}) RETURNING *`,values)).rows[0];
}
export async function remove(resource,id,schoolId){return (await pool.query(`DELETE FROM ${resources[resource].table} WHERE id=$1 AND school_id=$2 RETURNING id`,[id,schoolId])).rows[0];}
