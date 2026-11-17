import { pool } from '../config/db.js';
export const publicUser = u => ({id:u.id,name:u.name,email:u.email,role:u.role,active:u.active,mustChangePassword:Boolean(u.must_change_password)});
export const byEmail = async email => (await pool.query('SELECT * FROM users WHERE email=$1',[email])).rows[0];
export const byId = async (id,schoolId=null) => (await pool.query(
 schoolId
  ? "SELECT u.* FROM users u JOIN school_memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.school_id=$2 AND m.status='active'"
  : 'SELECT * FROM users WHERE id=$1',
 schoolId?[id,schoolId]:[id]
)).rows[0];
export async function create(data,hash,schoolId) {
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const {rows:[user]}=await client.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,active',[data.name,data.email,hash,data.role]);
  await client.query("INSERT INTO school_memberships(school_id,user_id,role,status,is_default) VALUES($1,$2,$3,'active',true)",[schoolId,user.id,data.role]);
  await client.query('COMMIT');return user;
 } catch(e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}
export async function list(limit,offset,schoolId) {return (await pool.query("SELECT u.id,u.name,u.email,m.role,u.active,u.created_at FROM users u JOIN school_memberships m ON m.user_id=u.id WHERE m.school_id=$1 AND m.status='active' ORDER BY u.created_at DESC,u.id LIMIT $2 OFFSET $3",[schoolId,limit,offset])).rows;}
