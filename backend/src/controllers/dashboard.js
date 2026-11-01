import { dashboard } from '../services/dashboard.js';
export const get=async(req,res)=>res.json(await dashboard(req.user));
