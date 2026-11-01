import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
export async function authenticate(req,res,next) {
 try {
 const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
 const payload=jwt.verify(token,env.JWT_SECRET,{algorithms:['HS256'],issuer:'school-api',audience:'school-web'});
 const {rows:[u]}=await pool.query('SELECT u.id,u.name,u.email,u.role,u.active FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE u.id=$1 AND s.id=$2 AND u.active=true AND s.revoked_at IS NULL AND s.expires_at>now()',[payload.sub,payload.sid]);
 if(!u) return res.status(401).json({message:'Authentication required'});
 req.user=u;req.sessionId=payload.sid;next();
 }catch(e){if(e.name?.includes('Token') || e.name==='JsonWebTokenError') return res.status(401).json({message:'Authentication required'});next(e);}
}
export const authorize=(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({message:'Insufficient permissions'});
export function originGuard(req,res,next) {
 if(req.headers.origin!==env.FRONTEND_ORIGIN) return res.status(403).json({message:'Untrusted origin'});
 next();
}
