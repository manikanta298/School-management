import * as model from '../models/academic.js';
import { fail } from './auth.js';
export async function save(resource,id,data,schoolId){
 const result=await model.save(resource,id,data,schoolId);
 if(!result)throw fail(404,'Record not found');return result;
}
export async function remove(resource,id,schoolId){if(!await model.remove(resource,id,schoolId))throw fail(404,'Record not found');}
export async function find(resource,id,schoolId){const record=await model.find(resource,id,schoolId);if(!record)throw fail(404,'Record not found');return record;}
export const list=model.list;
