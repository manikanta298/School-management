// Permission matrix for the school staff roles. admin, teacher, student and parent keep their existing,
// record-level rules in the models; the staff roles below act through these module permissions.
// 'view' = read-only school-wide access, 'manage' = full access to that module (except admin-only actions).
export const STAFF_ROLES=['principal','accountant','receptionist','librarian','transport_manager'];
export const ROLES=['admin',...STAFF_ROLES,'teacher','student','parent'];
export const MODULES=['academic','students','parents','teachers','staff','attendance','fees','exams','timetable','homework','notices','transport','calendar','dashboard'];
const view=(...m)=>Object.fromEntries(m.map(x=>[x,['view']]));
const manage=(...m)=>Object.fromEntries(m.map(x=>[x,['view','manage']]));
export const MATRIX={
 principal:{...view('academic','students','parents','teachers','staff','attendance','fees','exams','timetable','homework','transport','dashboard'),...manage('notices','calendar')},
 accountant:{...manage('fees'),...view('students','parents','notices','calendar')},
 receptionist:{...manage('students','parents'),...view('timetable','notices','calendar')},
 librarian:{...view('students','notices','calendar')},
 transport_manager:{...manage('transport'),...view('students','staff','notices','calendar')}
};
export const can=(role,module,action='view')=>role==='admin'||Boolean(MATRIX[role]?.[module]?.includes(action));
export const permissionsFor=role=>role==='admin'?Object.fromEntries(MODULES.map(m=>[m,['view','manage']])):(MATRIX[role]||null);
