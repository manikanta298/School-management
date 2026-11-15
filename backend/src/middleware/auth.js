import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
export async function authenticate(req,res,next) {
 try {
  const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  const payload=jwt.verify(token,env.JWT_SECRET,{algorithms:['HS256'],issuer:'school-api',audience:'school-web'});
  const {rows:[u]}=await pool.query(
   "SELECT u.id,u.name,u.email,m.role,u.active,s.active_school_id FROM users u JOIN auth_sessions s ON s.user_id=u.id JOIN school_memberships m ON m.user_id=s.user_id AND m.school_id=s.active_school_id WHERE u.id=$1 AND s.id=$2 AND u.active=true AND s.revoked_at IS NULL AND s.expires_at>now() AND m.status='active'",
   [payload.sub,payload.sid]
  );
  if(!u || (payload.schoolId && payload.schoolId!==u.active_school_id)) return res.status(401).json({message:'Authentication required'});
  req.user={id:u.id,name:u.name,email:u.email,role:u.role,active:u.active};
  req.schoolId=u.active_school_id;req.sessionId=payload.sid;next();
 }catch(e){if(e.name?.includes('Token') || e.name==='JsonWebTokenError') return res.status(401).json({message:'Authentication required'});next(e);}
}
export const authorize=(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({message:'Insufficient permissions'});
export function originGuard(req,res,next) {
 if(req.headers.origin!==env.FRONTEND_ORIGIN) return res.status(403).json({message:'Untrusted origin'});
 next();
}
