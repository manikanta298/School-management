import { pool } from '../config/db.js';
export const publicUser = u => ({id:u.id,name:u.name,email:u.email,role:u.role,active:u.active});
export const byEmail = async email => (await pool.query('SELECT * FROM users WHERE email=$1',[email])).rows[0];
export const byId = async id => (await pool.query('SELECT * FROM users WHERE id=$1',[id])).rows[0];
export async function create(data,hash) {return (await pool.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,active',[data.name,data.email,hash,data.role])).rows[0];}
export async function list(limit,offset) {return (await pool.query('SELECT id,name,email,role,active,created_at FROM users ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',[limit,offset])).rows;}
