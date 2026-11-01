import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './config/db.js';
await pool.query('SELECT 1');
const server=app.listen(env.PORT,()=>console.log(`API listening on ${env.PORT}`));
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{server.close(async()=>{await pool.end();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();});
