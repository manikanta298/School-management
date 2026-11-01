import { pool } from '../config/db.js';
// SQL identifiers come exclusively from this static allowlist, never request text.
export const resources={
 'academic-years':{table:'academic_years',fields:['name','start_date','end_date','is_current']},
 terms:{table:'terms',fields:['name','academic_year_id','start_date','end_date'],parent:'academic_year_id'},
 classes:{table:'classes',fields:['name','academic_year_id'],parent:'academic_year_id'},
 sections:{table:'sections',fields:['name','class_id','capacity'],parent:'class_id'},
 subjects:{table:'subjects',fields:['name','code']}
};
export async function list(resource,query){
 const {table,parent}=resources[resource];
 const values=[],filters=[];
 if(parent && query[parent]){values.push(query[parent]);filters.push(`${parent}=$${values.length}`);}
 values.push(query.limit,query.offset);
 return (await pool.query(`SELECT * FROM ${table} ${filters.length?'WHERE '+filters.join(' AND '):''} ORDER BY name,id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function find(resource,id){return (await pool.query(`SELECT * FROM ${resources[resource].table} WHERE id=$1`,[id])).rows[0];}
export async function save(resource,id,data){
 const {table,fields}=resources[resource];const values=fields.map(f=>data[f]);
 if(id){values.push(id);return (await pool.query(`UPDATE ${table} SET ${fields.map((f,i)=>`${f}=$${i+1}`).join(',')} WHERE id=$${values.length} RETURNING *`,values)).rows[0];}
 return (await pool.query(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,values)).rows[0];
}
export async function remove(resource,id){return (await pool.query(`DELETE FROM ${resources[resource].table} WHERE id=$1 RETURNING id`,[id])).rows[0];}
