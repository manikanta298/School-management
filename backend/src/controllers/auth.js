import * as users from '../models/users.js';
import * as auth from '../services/auth.js';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
const cookieOptions={httpOnly:true,secure:env.NODE_ENV==='production',sameSite:'strict',path:'/api/auth'};
function sendSession(res,result) {res.cookie('refreshToken',result.refresh,{...cookieOptions,maxAge:7*86400000});res.json({accessToken:result.accessToken,user:result.user});}
export async function login(req,res) {
 const user=await users.byEmail(req.body.email);
 const valid=await auth.matches(req.body.password,user?.password_hash || auth.dummyHash);
 if(!user || !valid || !user.active) throw auth.fail(401,'Invalid email or password');
 sendSession(res,await auth.issue(user));
}
export async function refresh(req,res) {try {sendSession(res,await auth.rotate(req.cookies.refreshToken));}catch(e){res.clearCookie('refreshToken',cookieOptions);throw e;}}
export async function logout(req,res) {
 if(req.cookies.refreshToken) await pool.query('UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=$1',[auth.digest(req.cookies.refreshToken)]);
 res.clearCookie('refreshToken',cookieOptions);res.status(204).end();
}
export async function changePassword(req,res) {
 const user=await users.byId(req.user.id);
 if(!await auth.matches(req.body.currentPassword,user.password_hash)) throw auth.fail(401,'Current password is incorrect');
 await auth.replacePassword(user.id,await auth.hashPassword(req.body.newPassword));
 res.clearCookie('refreshToken',cookieOptions);res.status(204).end();
}
export async function createUser(req,res) {res.status(201).json({user:await users.create(req.body,await auth.hashPassword(req.body.password))});}
export async function listUsers(req,res) {
 const limit=Number(req.query.limit??25),offset=Number(req.query.offset??0);
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0) throw auth.fail(400,'Invalid pagination');
 res.json({users:await users.list(limit,offset)});
}
export async function resetPassword(req,res) {
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) throw auth.fail(400,'Invalid user ID');
 if(!await users.byId(req.params.id)) throw auth.fail(404,'User not found');
 await auth.replacePassword(req.params.id,await auth.hashPassword(req.body.newPassword));res.status(204).end();
}
