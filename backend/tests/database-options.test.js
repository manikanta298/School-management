import test from 'node:test';
import assert from 'node:assert/strict';
import { rootCertificates } from 'node:tls';
import pg from 'pg';
import { databaseOptions } from '../src/config/database-options.js';
const DATABASE_URL = 'postgres://school:private@db.example/school?sslmode=require&application_name=school';
test('provider CA survives pg URL parsing and requires certificate verification', () => {
 for (const ca of [rootCertificates[0], rootCertificates[0].replace(/\n/g, '\\n')]) {
  const options = databaseOptions({DATABASE_URL, DATABASE_CA_CERT: ca});
  const client = new pg.Client(options);
  assert.equal(client.ssl.rejectUnauthorized, true);
  assert.equal(client.ssl.ca, rootCertificates[0]);
  assert.equal(new URL(options.connectionString).searchParams.get('application_name'), 'school');
  assert.equal(new URL(options.connectionString).searchParams.has('sslmode'), false);
 }
});
test('existing connection settings stay unchanged unless a CA is supplied', () => {
 assert.deepEqual(databaseOptions({DATABASE_URL}), {connectionString: DATABASE_URL});
});
test('invalid CA and conflicting client certificates fail without leaking values', () => {
 assert.throws(() => databaseOptions({DATABASE_URL, DATABASE_CA_CERT:'private-invalid-value'}), error => /DATABASE_CA_CERT/.test(error.message) && !error.message.includes('private-invalid-value'));
 assert.throws(() => databaseOptions({DATABASE_URL:DATABASE_URL+'&sslkey=private', DATABASE_CA_CERT:rootCertificates[0]}), /client-certificate/);
});
