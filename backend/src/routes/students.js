import { Router } from 'express';
import { authenticate,authorize } from '../middleware/auth.js';
import { validate } from '../validators/auth.js';
import * as v from '../validators/students.js';
import * as c from '../controllers/students.js';
export const studentsRouter=Router(),parentsRouter=Router();
const admin=authorize('admin');
const page=(req,res,next)=>{const parsed=v.listQuery.safeParse(req.query);if(!parsed.success)return res.status(400).json({message:'Invalid query'});req.directoryQuery=parsed.data;next();};
for(const [router,kind,roles] of [[studentsRouter,'students',['admin','student','parent']],[parentsRouter,'parents',['admin','parent']]]){
 router.use(authenticate,authorize(...roles),(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 for(const key of ['id','parentId','enrollmentId'])router.param(key,(req,res,next,value)=>v.id.safeParse(value).success?next():res.status(400).json({message:'Invalid record ID'}));
 router.get('/',page,c.list(kind));router.get('/:id',c.find(kind));
 router.post('/',admin,validate(kind==='students'?v.studentCreate:v.parentCreate),c.save(kind));
 router.put('/:id',admin,validate(kind==='students'?v.studentUpdate:v.parentUpdate),c.save(kind));
 router.delete('/:id',admin,c.remove(kind));
}
studentsRouter.get('/:id/parents',page,c.links);
studentsRouter.post('/:id/parents',admin,validate(v.link),c.addLink);
studentsRouter.delete('/:id/parents/:parentId',admin,c.removeLink);
studentsRouter.get('/:id/enrollments',page,c.enrollments);
studentsRouter.post('/:id/enrollments',admin,validate(v.enrollment),c.saveEnrollment);
studentsRouter.put('/:id/enrollments/:enrollmentId',admin,validate(v.enrollment),c.saveEnrollment);
studentsRouter.delete('/:id/enrollments/:enrollmentId',admin,c.removeEnrollment);
function errors(err,_req,res,next){
 if(err.code==='23505')return res.status(409).json({message:'Duplicate account profile, admission number, parent link, or enrollment for this year'});
 if(err.code==='23503')return res.status(409).json({message:'Wrong account role, missing reference, dependent records, or section/class/year mismatch'});
 if(err.code==='23514')return res.status(400).json({message:'Invalid dates or section capacity. Check admission, academic year dates, and available seats.'});
 next(err);
}
studentsRouter.use(errors);parentsRouter.use(errors);
