import * as service from '../services/fees.js';
export const structures=async(req,res)=>res.json({items:await service.structures(req.feeQuery)});
export const saveStructure=async(req,res)=>res.status(req.params.id?200:201).json({item:await service.saveStructure(req.params.id,req.body)});
export const list=async(req,res)=>res.json({items:await service.list(req.user,req.feeQuery)});
export const find=async(req,res)=>res.json({item:await service.find(req.user,req.params.id)});
export const create=async(req,res)=>res.status(201).json({item:await service.create(req.user,req.body)});
export const payments=async(req,res)=>res.json({items:await service.payments(req.user,req.params.id,req.feeQuery)});
export const pay=async(req,res)=>res.status(200).json(await service.pay(req.user,req.params.id,req.body));
export const reverse=async(req,res)=>{await service.reverse(req.user,req.params.id,req.params.paymentId,req.body.reason);res.status(204).end();};
export const voidInvoice=async(req,res)=>{await service.voidInvoice(req.user,req.params.id,req.body.reason);res.status(204).end();};
export const summary=async(req,res)=>res.json({items:await service.summary(req.user,req.feeQuery)});
export const events=async(req,res)=>res.json({items:await service.events(req.user,req.params.id,req.feeQuery)});

export const calendar=async(_req,res)=>res.json(await service.calendar());
