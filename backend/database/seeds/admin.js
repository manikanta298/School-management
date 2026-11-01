import { pool } from '../../src/config/db.js';
import { createUser } from '../../src/validators/auth.js';
import { hashPassword } from '../../src/services/auth.js';
try {
 const data=createUser.parse({name:process.env.ADMIN_NAME,email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD,role:'admin'});
 const hash=await hashPassword(data.password);
 const result=await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin') ON CONFLICT(email) DO NOTHING RETURNING id",[data.name,data.email,hash]);
 console.log(result.rowCount?'Administrator created':'Account already exists; unchanged');
} finally {await pool.end();}
