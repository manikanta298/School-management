import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const backupDirectory = resolve(repositoryRoot, process.argv[2] ?? 'backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = resolve(backupDirectory, `school-${timestamp}.dump`);

await mkdir(backupDirectory, { recursive: true });

const dump = spawn('docker', [
  'compose', 'exec', '-T', 'postgres',
  'pg_dump', '-U', 'school', '-d', 'school', '-Fc',
], {
  cwd: repositoryRoot,
  stdio: ['ignore', 'pipe', 'inherit'],
});
const dumpExit = new Promise((resolveExit, reject) => {
  dump.once('error', reject);
  dump.once('close', resolveExit);
});

try {
  await Promise.all([
    pipeline(dump.stdout, createWriteStream(backupPath, { flags: 'wx' })),
    dumpExit.then((code) => {
      if (code !== 0) throw new Error(`pg_dump exited with status ${code}`);
    }),
  ]);
  const { size } = await stat(backupPath);
  if (size === 0) throw new Error('pg_dump produced an empty backup');
  process.stdout.write(`Backup created: ${backupPath} (${size} bytes)\n`);
} catch (error) {
  dump.kill();
  await unlink(backupPath).catch(() => {});
  process.stderr.write(`Backup failed: ${error.message}\n`);
  process.exitCode = 1;
}
