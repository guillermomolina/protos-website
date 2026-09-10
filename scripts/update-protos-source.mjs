import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const lockPath = join(root, 'protos-source.lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const branch = process.argv[2] ?? 'main';

if (!/^[A-Za-z0-9._/-]+$/.test(branch)) {
  throw new Error(`Unsupported branch spelling: ${branch}`);
}

const output = execFileSync(
  'git',
  ['ls-remote', lock.repository, `refs/heads/${branch}`],
  { encoding: 'utf8' },
).trim();

const revision = output.split(/\s+/)[0] ?? '';
if (!/^[0-9a-f]{40}$/.test(revision)) {
  throw new Error(`Could not resolve ${lock.repository} branch ${branch}`);
}

lock.revision = revision;
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
console.log(`PROTOS_SOURCE_LOCK_UPDATED: branch=${branch} revision=${revision}`);
