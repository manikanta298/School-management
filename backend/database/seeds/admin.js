import { pool } from '../../src/config/db.js';
import { bootstrapAdmin } from '../bootstrap-admin.js';
try {
 const status = await bootstrapAdmin(pool, process.env);
 if (status === 'not-configured') throw new Error('Set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD before running seed:admin.');
 console.log(status === 'created' ? 'Administrator created' : 'Account already exists; unchanged');
} finally { await pool.end(); }
