import pg from 'pg';
import { env } from './env.js';
import { databaseOptions } from './database-options.js';
// PostgreSQL DATE is a calendar date, not a timezone-dependent JavaScript timestamp.
pg.types.setTypeParser(1082,value=>value);
export const pool = new pg.Pool(databaseOptions(env));
