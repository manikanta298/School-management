import { pool } from '../src/config/db.js';
import { readdir, readFile } from 'node:fs/promises';
const client = await pool.connect();
try {
 await client.query('BEGIN');
 await client.query("SELECT pg_advisory_xact_lock(7182026)");
 await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
 for (const name of (await readdir(new URL('./migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort()) {
  const done = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name]);
  if(!done.rowCount) {await client.query(await readFile(new URL(`./migrations/${name}`,import.meta.url),'utf8'));await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);}
 }
 await client.query('COMMIT');
} catch(e) {await client.query('ROLLBACK'); throw e;} finally {client.release();await pool.end();}
