import { pool } from '../config/db.js';
import { studentScope } from './dashboard.js';
const expiry=col=>`CASE WHEN ${col} IS NULL THEN NULL WHEN ${col}<CURRENT_DATE THEN 'expired' WHEN ${col}<=CURRENT_DATE+30 THEN 'expiring' ELSE 'ok' END`;
const vehicleColumns=`id,registration_number,capacity,driver_name,driver_phone,insurance_expiry::text AS insurance_expiry,permit_expiry::text AS permit_expiry,active,${expiry('insurance_expiry')} AS insurance_status,${expiry('permit_expiry')} AS permit_status`;
export async function vehicles(q){return (await pool.query(`SELECT ${vehicleColumns} FROM transport_vehicles ORDER BY registration_number LIMIT $1 OFFSET $2`,[q.limit,q.offset])).rows;}
export async function vehicle(id){return (await pool.query(`SELECT ${vehicleColumns} FROM transport_vehicles WHERE id=$1`,[id])).rows[0];}
export async function saveVehicle(id,d){
 const values=[d.registration_number,d.capacity,d.driver_name,d.driver_phone,d.insurance_expiry,d.permit_expiry,d.active];
 if(id){values.push(id);return (await pool.query('UPDATE transport_vehicles SET registration_number=$1,capacity=$2,driver_name=$3,driver_phone=$4,insurance_expiry=$5,permit_expiry=$6,active=$7,updated_at=now() WHERE id=$8 RETURNING id',values)).rows[0];}
 return (await pool.query('INSERT INTO transport_vehicles(registration_number,capacity,driver_name,driver_phone,insurance_expiry,permit_expiry,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',values)).rows[0];
}
const routeSelect=`SELECT r.id,r.name,r.vehicle_id,r.active,v.registration_number AS vehicle_registration,coalesce((SELECT json_agg(json_build_object('id',s.id,'name',s.name,'sequence',s.sequence) ORDER BY s.sequence) FROM transport_stops s WHERE s.route_id=r.id),'[]'::json) AS stops FROM transport_routes r LEFT JOIN transport_vehicles v ON v.id=r.vehicle_id`;
export async function routes(q){return (await pool.query(`${routeSelect} ORDER BY r.name LIMIT $1 OFFSET $2`,[q.limit,q.offset])).rows;}
export async function route(id){return (await pool.query(`${routeSelect} WHERE r.id=$1`,[id])).rows[0];}
export async function saveRoute(id,d){
 if(id)return (await pool.query('UPDATE transport_routes SET name=$1,vehicle_id=$2,active=$3,updated_at=now() WHERE id=$4 RETURNING id',[d.name,d.vehicle_id,d.active,id])).rows[0];
 return (await pool.query('INSERT INTO transport_routes(name,vehicle_id,active) VALUES($1,$2,$3) RETURNING id',[d.name,d.vehicle_id,d.active])).rows[0];
}
export async function addStop(routeId,d){return (await pool.query('INSERT INTO transport_stops(route_id,name,sequence) SELECT id,$2,$3 FROM transport_routes WHERE id=$1 RETURNING id,route_id',[routeId,d.name,d.sequence])).rows[0];}
export async function saveStop(id,d){return (await pool.query('UPDATE transport_stops SET name=$2,sequence=$3 WHERE id=$1 RETURNING id,route_id',[id,d.name,d.sequence])).rows[0];}
export async function removeStop(id){return (await pool.query('DELETE FROM transport_stops WHERE id=$1 RETURNING route_id',[id])).rows[0];}
export async function allocations(user,q){
 const values=[],filters=[studentScope(user,values)],admin=user.role==='admin';
 for(const [key,col] of [['route_id','r.id'],['academic_year_id','a.academic_year_id']])if(q[key]){values.push(q[key]);filters.push(`${col}=$${values.length}`);}
 values.push(q.limit,q.offset);
 return (await pool.query(`SELECT a.id,a.student_id,a.stop_id,a.academic_year_id,u.name AS student_name,s.admission_number,r.id AS route_id,r.name AS route_name,st.name AS stop_name,st.sequence AS stop_sequence,v.registration_number AS vehicle_registration${admin?',v.driver_name,v.driver_phone':''} FROM transport_allocations a JOIN students s ON s.id=a.student_id JOIN users u ON u.id=s.user_id JOIN transport_stops st ON st.id=a.stop_id JOIN transport_routes r ON r.id=st.route_id LEFT JOIN transport_vehicles v ON v.id=r.vehicle_id WHERE ${filters.join(' AND ')} ORDER BY r.name,st.sequence,u.name,a.id LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
}
export async function allocate(d){return (await pool.query('INSERT INTO transport_allocations(student_id,stop_id,academic_year_id) VALUES($1,$2,$3) RETURNING id',[d.student_id,d.stop_id,d.academic_year_id])).rows[0];}
export async function reallocate(id,stopId){return (await pool.query('UPDATE transport_allocations SET stop_id=$2 WHERE id=$1 RETURNING id',[id,stopId])).rows[0];}
export async function deallocate(id){return (await pool.query('DELETE FROM transport_allocations WHERE id=$1 RETURNING id',[id])).rows[0];}
