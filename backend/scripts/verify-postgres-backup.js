import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const backupPath = process.argv[2] ? resolve(repositoryRoot, process.argv[2]) : null;

if (!backupPath) {
  process.stderr.write('Usage: npm run db:verify-backup -- <path-to-backup.dump>\n');
  process.exit(2);
}

await access(backupPath);

function runCompose(args, inputPath) {
  const child = spawn('docker', ['compose', 'exec', '-T', 'postgres', ...args], {
    cwd: repositoryRoot,
    stdio: [inputPath ? 'pipe' : 'ignore', 'inherit', 'inherit'],
  });
  const exit = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  const input = inputPath
    ? pipeline(createReadStream(inputPath), child.stdin)
    : Promise.resolve();

  return Promise.all([input, exit]).then(([, code]) => {
    if (code !== 0) throw new Error(`Docker command exited with status ${code}`);
  });
}

const verificationDatabase = `backup_check_${Date.now()}_${randomBytes(3).toString('hex')}`;
let databaseCreated = false;
let verificationFailed = false;

try {
  await runCompose(['createdb', '-U', 'school', verificationDatabase]);
  databaseCreated = true;
  await runCompose([
    'pg_restore', '-U', 'school', '-d', verificationDatabase,
    '--exit-on-error', '--no-owner', '--no-privileges',
  ], backupPath);
  process.stdout.write('Backup restored successfully into a temporary database.\n');
} catch (error) {
  verificationFailed = true;
  process.stderr.write(`Backup verification failed: ${error.message}\n`);
} finally {
  if (databaseCreated) {
    try {
      await runCompose(['dropdb', '-U', 'school', verificationDatabase]);
    } catch (error) {
      verificationFailed = true;
      process.stderr.write(`Could not remove temporary database ${verificationDatabase}: ${error.message}\n`);
    }
  }
}

if (verificationFailed) process.exitCode = 1;
