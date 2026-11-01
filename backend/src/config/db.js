import pg from 'pg';
import { env } from './env.js';
// PostgreSQL DATE is a calendar date, not a timezone-dependent JavaScript timestamp.
pg.types.setTypeParser(1082,value=>value);
export const pool = new pg.Pool({connectionString:env.DATABASE_URL});
