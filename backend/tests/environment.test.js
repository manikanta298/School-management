import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { parseEnvironment } from '../src/config/environment.js';
const valid = { DATABASE_URL: 'postgres://school:private-password@db/school', JWT_SECRET: 'a'.repeat(64), FRONTEND_ORIGIN: 'https://school.example', NODE_ENV: 'production' };
test('missing Render settings are named without exposing credentials', () => {
 assert.throws(() => parseEnvironment({}), /DATABASE_URL, JWT_SECRET, FRONTEND_ORIGIN/);
 assert.throws(() => parseEnvironment({...valid, PORT: 'private-invalid-port'}), error => !error.message.includes('private-password') && !error.message.includes('private-invalid-port'));
});
test('accepts Render generated 256-bit secrets and rejects short secrets', () => {
 assert.equal(parseEnvironment({...valid, JWT_SECRET: randomBytes(32).toString('base64')}).PORT, 4000);
 assert.throws(() => parseEnvironment({...valid, JWT_SECRET: 'a'.repeat(32)}), /JWT_SECRET/);
});
test('production rejects insecure origins, placeholder secrets and non-Postgres URLs', () => {
 for (const changes of [{FRONTEND_ORIGIN:'http://school.example'}, {FRONTEND_ORIGIN:'https://school.example/api'}, {JWT_SECRET:'replace-'+'a'.repeat(64)}, {DATABASE_URL:'https://db.example'}]) {
  assert.throws(() => parseEnvironment({...valid, ...changes}));
 }
 assert.equal(parseEnvironment({...valid, FRONTEND_ORIGIN:'https://school.example/'}).FRONTEND_ORIGIN, 'https://school.example');
});
