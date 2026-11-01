import * as model from '../models/teachers.js';
import { fail } from './auth.js';
export const list=model.list;
export async function find(user,id){const result=await model.find(user,id);if(!result)throw fail(404,'Teacher not found');return result;}
export async function save(user,id,data){const result=await model.save(id,data);if(!result)throw fail(404,'Teacher not found');return find(user,result.id);}
export async function remove(id){if(!await model.remove(id))throw fail(404,'Teacher not found');}
export async function assignments(user,teacherId,query){await find(user,teacherId);return model.assignments(user,teacherId,query);}
export async function findAssignment(user,teacherId,id,active=false){const result=await model.assignment(user,teacherId,id,active);if(!result)throw fail(404,'Assignment not found');return result;}
export async function saveAssignment(user,teacherId,id,data){await find(user,teacherId);const result=await model.saveAssignment(teacherId,id,data);if(!result)throw fail(404,'Assignment or class not found');return findAssignment(user,teacherId,result.id);}
export async function removeAssignment(teacherId,id){if(!await model.removeAssignment(teacherId,id))throw fail(404,'Assignment not found');}
export async function roster(user,teacherId,id,query){await findAssignment(user,teacherId,id,true);return model.roster(user,teacherId,id,query);}
