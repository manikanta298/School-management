import bcrypt from 'bcrypt';
import { createUser } from '../src/validators/auth.js';

export async function bootstrapAdmin(pool, source) {
 const keys = ['ADMIN_NAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];
 if (!keys.some(key => source[key] !== undefined)) return 'not-configured';
 const parsed = createUser.safeParse({name:source.ADMIN_NAME, email:source.ADMIN_EMAIL, password:source.ADMIN_PASSWORD, role:'admin'});
 if (!parsed.success) throw new Error('Administrator setup requires valid ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters, at most 72 UTF-8 bytes).');
 const data = parsed.data;
 // Never change an existing account, its role, activity, or password on restart.
 const existing = await pool.query('SELECT id FROM users WHERE email=$1', [data.email]);
 if (existing.rowCount) return 'existing';
 const hash = await bcrypt.hash(data.password, 12);
 const result = await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin') ON CONFLICT(email) DO NOTHING RETURNING id", [data.name, data.email, hash]);
 return result.rowCount ? 'created' : 'existing';
}
