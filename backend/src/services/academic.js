import * as model from '../models/academic.js';
import { fail } from './auth.js';
export async function save(resource,id,data){
 const result=await model.save(resource,id,data);
 if(!result)throw fail(404,'Record not found');return result;
}
export async function remove(resource,id){if(!await model.remove(resource,id))throw fail(404,'Record not found');}
export async function find(resource,id){const record=await model.find(resource,id);if(!record)throw fail(404,'Record not found');return record;}
export const list=model.list;
