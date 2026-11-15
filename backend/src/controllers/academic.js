import * as service from '../services/academic.js';
export const list=async(req,res)=>res.json({items:await service.list(req.params.resource,req.academicQuery,req.schoolId)});
export const find=async(req,res)=>res.json({item:await service.find(req.params.resource,req.params.id,req.schoolId)});
export const create=async(req,res)=>res.status(201).json({item:await service.save(req.params.resource,null,req.body,req.schoolId)});
export const update=async(req,res)=>res.json({item:await service.save(req.params.resource,req.params.id,req.body,req.schoolId)});
export const remove=async(req,res)=>{await service.remove(req.params.resource,req.params.id,req.schoolId);res.status(204).end();};
