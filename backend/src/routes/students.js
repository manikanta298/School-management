import { Router } from 'express';
import { authenticate,authorize } from '../middleware/auth.js';
import { validate } from '../validators/auth.js';
import * as v from '../validators/students.js';
import * as c from '../controllers/students.js';
import * as exchange from '../services/studentExchange.js';
export const studentsRouter=Router(),parentsRouter=Router();
const admin=authorize('admin');
const page=(req,res,next)=>{const parsed=v.listQuery.safeParse(req.query);if(!parsed.success)return res.status(400).json({message:'Invalid query'});req.directoryQuery=parsed.data;next();};
studentsRouter.get('/export.csv',authenticate,admin,async(req,res)=>{res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="students.csv"','Cache-Control':'no-store'});res.send(await exchange.exportCsv(req.schoolId));});
for(const [router,kind,roles] of [[studentsRouter,'students',['admin','student','parent']],[parentsRouter,'parents',['admin','parent']]]){
 router.use(authenticate,authorize(...roles),(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 for(const key of ['id','parentId','enrollmentId'])router.param(key,(req,res,next,value)=>v.id.safeParse(value).success?next():res.status(400).json({message:'Invalid record ID'}));
 router.get('/',page,c.list(kind));router.get('/:id',c.find(kind));
 router.post('/',admin,validate(kind==='students'?v.studentCreate:v.parentCreate),c.save(kind));
 router.put('/:id',admin,validate(kind==='students'?v.studentUpdate:v.parentUpdate),c.save(kind));
 router.delete('/:id',admin,c.remove(kind));
}
studentsRouter.post('/promote',admin,validate(v.promote),async(req,res)=>res.json(await exchange.promote(req.schoolId,req.body)));
studentsRouter.post('/bulk-update',admin,validate(v.bulkUpdate),async(req,res)=>res.json(await exchange.bulkUpdate(req.schoolId,req.body)));
studentsRouter.get('/:id/parents',page,c.links);
studentsRouter.post('/:id/parents',admin,validate(v.link),c.addLink);
studentsRouter.delete('/:id/parents/:parentId',admin,c.removeLink);
studentsRouter.get('/:id/enrollments',page,c.enrollments);
studentsRouter.post('/:id/enrollments',admin,validate(v.enrollment),c.saveEnrollment);
studentsRouter.put('/:id/enrollments/:enrollmentId',admin,validate(v.enrollment),c.saveEnrollment);
studentsRouter.delete('/:id/enrollments/:enrollmentId',admin,c.removeEnrollment);
studentsRouter.post('/:id/status',admin,validate(v.statusChange),c.setStatus);
studentsRouter.get('/:id/status-history',admin,page,c.statusHistory);
function errors(err,_req,res,next){
 if(err.code==='23505')return res.status(409).json({message:'Duplicate account profile, admission number, parent link, or enrollment for this school and year'});
 if(err.code==='23503')return res.status(409).json({message:'Wrong account role, missing reference, cross-school reference, dependent records, or section/class/year mismatch'});
 if(err.code==='23514')return res.status(400).json({message:'Invalid dates, section capacity or protected attendance history. Check admission, year dates, available seats and saved attendance.'});
 next(err);
}
studentsRouter.use(errors);parentsRouter.use(errors);
