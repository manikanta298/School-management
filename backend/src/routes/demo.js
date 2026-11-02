import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import {authenticate,authorize,originGuard} from '../middleware/auth.js';
import {demoStatus,seedDemo} from '../services/demo.js';
export const demoRouter=Router();
demoRouter.use(authenticate,authorize('admin'));
demoRouter.get('/',async(_req,res)=>res.json(await demoStatus()));
demoRouter.post('/',rateLimit({windowMs:3600000,limit:3,standardHeaders:'draft-8',legacyHeaders:false}),originGuard,async(req,res)=>{
 if(!req.body||Object.keys(req.body).length!==1||req.body.confirmation!=='LOAD_DEMO_DATA')return res.status(400).json({message:'Explicit demo-data confirmation required'});
 const result=await seedDemo(req.user.id);res.status(result.created?201:200).json(result);
});
