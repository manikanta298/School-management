import * as model from '../models/students.js';
import { fail } from './auth.js';
export const list=(kind,user,schoolId,query)=>model.list(kind,user,schoolId,query);
export async function find(kind,user,schoolId,id){const result=await model.find(kind,user,schoolId,id);if(!result)throw fail(404,'Record not found');return result;}
export async function save(kind,user,schoolId,id,data){const result=await (kind==='students'?model.saveStudent(schoolId,id,data):model.saveParent(schoolId,id,data));if(!result)throw fail(404,'Record not found');return find(kind,user,schoolId,result.id);}
export async function remove(kind,schoolId,id){if(!await model.remove(kind,schoolId,id))throw fail(404,'Record not found');}
export async function links(user,schoolId,studentId,query){await find('students',user,schoolId,studentId);return model.links(schoolId,studentId,user,query);}
export async function addLink(user,schoolId,studentId,data){await find('students',user,schoolId,studentId);return model.addLink(schoolId,studentId,data);}
export async function removeLink(schoolId,studentId,parentId){if(!await model.removeLink(schoolId,studentId,parentId))throw fail(404,'Link not found');}
export async function enrollments(user,schoolId,studentId,query){await find('students',user,schoolId,studentId);return model.enrollments(schoolId,studentId,query);}
export async function saveEnrollment(user,schoolId,studentId,id,data){await find('students',user,schoolId,studentId);const result=await model.saveEnrollment(schoolId,studentId,id,data);if(!result)throw fail(404,'Enrollment or section not found');return result;}
export async function removeEnrollment(schoolId,studentId,id){if(!await model.removeEnrollment(schoolId,studentId,id))throw fail(404,'Enrollment not found');}
export async function setStatus(user,schoolId,studentId,data){const result=await model.setStatus(schoolId,studentId,user.id,data);if(!result)throw fail(404,'Record not found');const item=await find('students',user,schoolId,studentId);return {...item,closed_enrollments:result.closed_enrollments};}
export async function statusHistory(schoolId,studentId,query){return model.statusHistory(schoolId,studentId,query);}
