import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { runMigrations } from '../database/run-migrations.js';
import { bootstrapAdmin } from '../database/bootstrap-admin.js';
try {
 await runMigrations(pool);
 console.log('Database migrations complete');
} catch (error) {
 console.error('Database startup failed:', error.code || error.name, 'Check database permissions, connectivity and migration state.');
 await pool.end();
 process.exit(1);
}
try {
 const status = await bootstrapAdmin(pool, process.env);
 console.log(status === 'created' ? 'Administrator created' : status === 'existing' ? 'Administrator setup: account already exists; unchanged' : 'Administrator setup not configured; use an existing school account or configure ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD');
} catch (error) {
 console.error('Administrator setup failed:', error.code || 'Check ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters, at most 72 UTF-8 bytes).');
 await pool.end();
 process.exit(1);
}
const server=app.listen(env.PORT,'0.0.0.0',()=>console.log(`API listening on ${env.PORT}`));
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{server.close(async()=>{await pool.end();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();});
