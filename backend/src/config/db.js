



import pg from 'pg';
import { readFileSync } from 'node:fs';
import { env } from './env.js';
import { databaseOptions } from './database-options.js';

pg.types.setTypeParser(1082, value => value);

export const pool = new pg.Pool(databaseOptions({
  ...env,
  DATABASE_CA_CERT: readFileSync('/etc/secrets/ca.pem', 'utf8')
}));
