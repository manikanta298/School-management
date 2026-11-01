import * as service from '../services/attendance.js';
export const sections=async(req,res)=>res.json(await service.sections(req.user,req.attendanceQuery));
export const register=async(req,res)=>res.json(await service.register(req.user,req.attendanceQuery));
export const save=async(req,res)=>res.json(await service.save(req.user,req.body));
export const summary=async(req,res)=>res.json(await service.summary(req.user,req.attendanceQuery));
export const history=async(req,res)=>res.json(await service.history(req.user,req.params.id,req.attendanceQuery));
export const audit=async(req,res)=>res.json(await service.audit(req.user,req.attendanceQuery));

export const calendar=async(_req,res)=>res.json(await service.calendar());
