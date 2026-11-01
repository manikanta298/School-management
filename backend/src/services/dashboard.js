import { pool } from '../config/db.js';
import { read } from '../models/dashboard.js';
import { fail } from './auth.js';
export async function dashboard(user){const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const {rows:[actor]}=await c.query('SELECT role,active FROM users WHERE id=$1',[user.id]);if(!actor?.active||actor.role!==user.role)throw fail(401,'Authentication required');const result=await read(user,c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
