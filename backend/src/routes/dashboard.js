import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { get } from '../controllers/dashboard.js';
export const dashboardRouter=Router();
dashboardRouter.use(authenticate,(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
dashboardRouter.get('/',(req,res,next)=>Object.keys(req.query).length?res.status(400).json({message:'Dashboard accepts no user/role override query'}):next(),get);
