import * as model from '../models/students.js';
import { fail } from './auth.js';
export const list=model.list;
export async function find(kind,user,id){const result=await model.find(kind,user,id);if(!result)throw fail(404,'Record not found');return result;}
export async function save(kind,user,id,data){
 const result=await (kind==='students'?model.saveStudent(id,data):model.saveParent(id,data));
 if(!result)throw fail(404,'Record not found');return find(kind,user,result.id);
}
export async function remove(kind,id){if(!await model.remove(kind,id))throw fail(404,'Record not found');}
export async function links(user,studentId,query){await find('students',user,studentId);return model.links(studentId,user,query);}
export async function addLink(user,studentId,data){await find('students',user,studentId);return model.addLink(studentId,data);}
export async function removeLink(studentId,parentId){if(!await model.removeLink(studentId,parentId))throw fail(404,'Link not found');}
export async function enrollments(user,studentId,query){await find('students',user,studentId);return model.enrollments(studentId,query);}
export async function saveEnrollment(user,studentId,id,data){await find('students',user,studentId);const result=await model.saveEnrollment(studentId,id,data);if(!result)throw fail(404,'Enrollment or section not found');return result;}
export async function removeEnrollment(studentId,id){if(!await model.removeEnrollment(studentId,id))throw fail(404,'Enrollment not found');}
