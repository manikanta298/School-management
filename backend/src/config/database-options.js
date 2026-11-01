import { X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export function databaseOptions(env) {
 const file = env.DATABASE_CA_CERT_FILE || (existsSync('/etc/secrets/ca.pem') ? '/etc/secrets/ca.pem' : undefined);
 let certificate = env.DATABASE_CA_CERT;
 if (!certificate && file) {
  try { certificate = readFileSync(file, 'utf8'); } catch {
   throw new Error('Cannot read database CA file. Check DATABASE_CA_CERT_FILE and secret-file permissions.');
  }
  if (!certificate.trim()) throw new Error('Database CA file is empty.');
 }
 if (!certificate) return { connectionString: env.DATABASE_URL };
 const ca = certificate.replace(/\\n/g, '\n');
 try {
  const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (!certificates?.length) throw new Error();
  for (const certificate of certificates) new X509Certificate(certificate);
 } catch {
  throw new Error('DATABASE_CA_CERT must contain your database provider’s PEM CA certificate bundle.');
 }
 const url = new URL(env.DATABASE_URL);
 // pg lets URL SSL parameters replace the entire ssl object, including its CA.
 // Reject client-certificate settings rather than silently dropping credentials.
 for (const key of ['sslcert', 'sslkey']) {
  if (url.searchParams.has(key)) throw new Error('Do not combine DATABASE_CA_CERT with URL client-certificate settings.');
 }
 for (const key of ['ssl', 'sslmode', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
 return { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true } };
}
