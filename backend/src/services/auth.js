import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { publicUser } from '../models/users.js';
export const digest = t=>createHash('sha256').update(t).digest('hex');
export const fail=(status,message)=>Object.assign(new Error(message),{status});
export const hashPassword = p=>bcrypt.hash(p,12);
export const matches = (p,h)=>bcrypt.compare(p,h);
export const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
export async function issue(user,client=pool) {
 const refresh=randomBytes(48).toString('hex'),sid=randomUUID();
 await client.query("INSERT INTO auth_sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",[sid,user.id,digest(refresh)]);
 return {refresh,accessToken:jwt.sign({sid},env.JWT_SECRET,{subject:user.id,expiresIn:'15m',algorithm:'HS256',issuer:'school-api',audience:'school-web'}),user:publicUser(user)};
}
export async function rotate(token) {
 if(!token || !/^[a-f0-9]{96}$/.test(token)) throw fail(401,'Session expired');
 const c=await pool.connect();
 try {
  await c.query('BEGIN');
  const {rows:[s]}=await c.query('SELECT * FROM auth_sessions WHERE token_hash=$1 FOR UPDATE',[digest(token)]);
  if(!s || s.revoked_at || new Date(s.expires_at)<=new Date()) {
   if(s) await c.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[s.user_id]);
   await c.query('COMMIT');throw fail(401,'Session expired');
  }
  const {rows:[u]}=await c.query('SELECT * FROM users WHERE id=$1 AND active=true',[s.user_id]);
  if(!u) throw fail(401,'Session expired');
  await c.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1',[s.id]);
  const result=await issue(u,c);await c.query('COMMIT');return result;
 } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
}
export async function replacePassword(userId,hash) {
 const c=await pool.connect();try {await c.query('BEGIN');await c.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2',[hash,userId]);await c.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[userId]);await c.query('COMMIT');} catch(e){await c.query('ROLLBACK');throw e;} finally{c.release();}
}
