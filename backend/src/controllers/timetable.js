import * as service from '../services/timetable.js';
export const calendar=async(_req,res)=>res.json(await service.calendar());
export const list=async(req,res)=>res.json({items:await service.list(req.user,req.scheduleQuery)});
export const find=async(req,res)=>res.json({item:await service.find(req.user,req.params.id)});
export const rooms=async(req,res)=>res.json({items:await service.rooms(req.scheduleQuery)});
export const saveRoom=async(req,res)=>res.status(req.params.id?200:201).json({item:await service.saveRoom(req.user,req.params.id,req.body)});
export const save=async(req,res)=>res.status(req.params.id?200:201).json({item:await service.save(req.user,req.params.id,req.body)});
export const deactivate=async(req,res)=>res.json({item:await service.deactivate(req.user,req.params.id,req.body)});
export const audit=async(req,res)=>res.json({items:await service.audit(req.user,req.params.id,req.scheduleQuery)});

export const assignments=async(req,res)=>res.json({items:await service.assignments(req.scheduleQuery)});
