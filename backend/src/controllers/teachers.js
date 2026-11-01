import * as service from '../services/teachers.js';
export const list=async(req,res)=>res.json({items:await service.list(req.user,req.teacherQuery)});
export const find=async(req,res)=>res.json({item:await service.find(req.user,req.params.id)});
export const save=async(req,res)=>res.status(req.params.id?200:201).json({item:await service.save(req.user,req.params.id,req.body)});
export const remove=async(req,res)=>{await service.remove(req.params.id);res.status(204).end();};
export const assignments=async(req,res)=>res.json({items:await service.assignments(req.user,req.params.id,req.teacherQuery)});
export const saveAssignment=async(req,res)=>res.status(req.params.assignmentId?200:201).json({item:await service.saveAssignment(req.user,req.params.id,req.params.assignmentId,req.body)});
export const removeAssignment=async(req,res)=>{await service.removeAssignment(req.params.id,req.params.assignmentId);res.status(204).end();};
export const roster=async(req,res)=>res.json({items:await service.roster(req.user,req.params.id,req.params.assignmentId,req.teacherQuery)});
