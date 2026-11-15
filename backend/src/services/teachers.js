import * as model from '../models/teachers.js';
import { fail } from './auth.js';
export const list=(user,schoolId,query)=>model.list(user,schoolId,query);
export async function find(user,schoolId,id){const result=await model.find(user,schoolId,id);if(!result)throw fail(404,'Teacher not found');return result;}
export async function save(user,schoolId,id,data){const result=await model.save(schoolId,id,data);if(!result)throw fail(404,'Teacher not found');return find(user,schoolId,result.id);}
export async function remove(schoolId,id){if(!await model.remove(schoolId,id))throw fail(404,'Teacher not found');}
export async function assignments(user,schoolId,teacherId,query){await find(user,schoolId,teacherId);return model.assignments(user,schoolId,teacherId,query);}
export async function findAssignment(user,schoolId,teacherId,id,active=false){const result=await model.assignment(user,schoolId,teacherId,id,active);if(!result)throw fail(404,'Assignment not found');return result;}
export async function saveAssignment(user,schoolId,teacherId,id,data){await find(user,schoolId,teacherId);const result=await model.saveAssignment(schoolId,teacherId,id,data);if(!result)throw fail(404,'Assignment or class not found');return findAssignment(user,schoolId,teacherId,result.id);}
export async function removeAssignment(schoolId,teacherId,id){if(!await model.removeAssignment(schoolId,teacherId,id))throw fail(404,'Assignment not found');}
export async function roster(user,schoolId,teacherId,id,query){await findAssignment(user,schoolId,teacherId,id,true);return model.roster(user,schoolId,teacherId,id,query);}
