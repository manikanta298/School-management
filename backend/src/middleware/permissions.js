import { STAFF_ROLES,can } from '../config/permissions.js';
const READ=new Set(['GET','HEAD','OPTIONS']);
// For staff roles only: checks the module permission, blocks writes for view-only roles and (unless convert is false)
// lets the role use the module's existing admin read/write scope. The real role stays in req.user.realRole.
export const moduleAccess=(module,{convert=true}={})=>(req,res,next)=>{
 const role=req.user.role;
 if(!STAFF_ROLES.includes(role))return next();
 if(!can(role,module,'view'))return res.status(403).json({message:'Insufficient permissions'});
 const manage=can(role,module,'manage');
 if(!manage&&!READ.has(req.method))return res.status(403).json({message:'Read-only access'});
 if(manage||convert)req.user={...req.user,role:'admin',realRole:role,readOnly:!manage};
 next();
};
export const adminOnly=(req,res,next)=>req.user.realRole?res.status(403).json({message:'Administrator only'}):next();
