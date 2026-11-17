export const STAFF_ROLES=['principal','accountant','receptionist','librarian','transport_manager'];
export const ROLE_LABELS={admin:'Administrator',principal:'Principal',accountant:'Accountant',receptionist:'Receptionist',librarian:'Librarian',transport_manager:'Transport manager',teacher:'Teacher',student:'Student',parent:'Parent'};
export const can=(user,module,action='view')=>user?.role==='admin'||Boolean(user?.permissions?.[module]?.includes(action));
// Staff roles use a module's existing admin screens when their permissions allow it (read-only unless they can manage).
// needManage: only switch to the admin screen when the role can manage the module (view-only roles keep the plain read view).
export function asModule(user,module,{needManage=false}={}){
 if(!user||!STAFF_ROLES.includes(user.role)||!can(user,module,needManage?'manage':'view'))return user;
 return {...user,role:'admin',realRole:user.role,readOnly:!can(user,module,'manage')};
}
