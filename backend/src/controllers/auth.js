import * as users from '../models/users.js';
import * as auth from '../services/auth.js';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
const cookieOptions={httpOnly:true,secure:env.NODE_ENV==='production',sameSite:'strict',path:'/api/auth'};
function sendSession(res,result) {res.cookie('refreshToken',result.refresh,{...cookieOptions,maxAge:7*86400000});res.json({accessToken:result.accessToken,user:result.user,activeSchoolId:result.schoolId});}
export async function login(req,res) {
 const user=await users.byEmail(req.body.email);
 const valid=await auth.matches(req.body.password,user?.password_hash || auth.dummyHash);
 if(!user || !valid || !user.active) {await auth.recordLogin(req,{userId:user?.id??null,email:req.body.email,success:false,reason:!user?'unknown_user':!valid?'bad_password':'inactive'});throw auth.fail(401,'Invalid email or password');}
 let result;try {result=await auth.issue(user,undefined,null,auth.clientMeta(req));} catch(e) {await auth.recordLogin(req,{userId:user.id,email:user.email,success:false,reason:'no_membership'});throw e;}
 await auth.recordLogin(req,{userId:user.id,email:user.email,success:true,schoolId:result.schoolId});sendSession(res,result);
}
export async function refresh(req,res) {try {sendSession(res,await auth.rotate(req.cookies.refreshToken));}catch(e){res.clearCookie('refreshToken',cookieOptions);throw e;}}
export async function schools(req,res) {res.json({items:await auth.schoolsFor(req.user.id),activeSchoolId:req.schoolId});}
export async function switchSchool(req,res) {const user=await users.byId(req.user.id);if(!user?.active) throw auth.fail(401,'Authentication required');sendSession(res,await auth.switchSchool(user,req.sessionId,req.body.school_id,auth.clientMeta(req)));}
export async function sessions(req,res) {res.json({items:await auth.listSessions(req.user.id,req.sessionId)});}
export async function revokeSession(req,res) {
 if(!await auth.revokeSession(req.user.id,req.params.id)) throw auth.fail(404,'Session not found');
 if(req.params.id===req.sessionId) res.clearCookie('refreshToken',cookieOptions);
 res.status(204).end();
}
export async function logoutAll(req,res) {await auth.revokeAll(req.user.id);res.clearCookie('refreshToken',cookieOptions);res.status(204).end();}
export async function loginHistory(req,res) {res.json({items:await auth.loginHistory(req.user.id)});}
export async function adminRevokeSessions(req,res) {
 if(!await auth.memberOfSchool(req.params.userId,req.schoolId)) throw auth.fail(404,'User not found in this school');
 res.json({revoked:await auth.adminRevokeSessions(req.params.userId,req.schoolId)});
}
export async function adminLoginHistory(req,res) {
 if(!await auth.memberOfSchool(req.params.userId,req.schoolId)) throw auth.fail(404,'User not found in this school');
 res.json({items:await auth.adminLoginHistory(req.params.userId,req.schoolId)});
}
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
export async function createUser(req,res) {res.status(201).json({user:await users.create(req.body,await auth.hashPassword(req.body.password),req.schoolId)});}
export async function listUsers(req,res) {
 const limit=Number(req.query.limit??25),offset=Number(req.query.offset??0);
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0) throw auth.fail(400,'Invalid pagination');
 res.json({users:await users.list(limit,offset,req.schoolId)});
}
export async function resetPassword(req,res) {
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) throw auth.fail(400,'Invalid user ID');
 if(!await users.byId(req.params.id,req.schoolId)) throw auth.fail(404,'User not found');
 await auth.replacePassword(req.params.id,await auth.hashPassword(req.body.newPassword));res.status(204).end();
}
