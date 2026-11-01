import { pool } from '../src/config/db.js';
import { runMigrations } from './run-migrations.js';
try { await runMigrations(pool); } finally { await pool.end(); }
