import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const lockPath = join(root, 'protos-source.lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

if (
  lock.schemaVersion !== 1 ||
  typeof lock.repository !== 'string' ||
  typeof lock.revision !== 'string' ||
  !/^[0-9a-f]{40}$/.test(lock.revision) ||
  !Array.isArray(lock.canonicalPaths)
) {
  throw new Error('Invalid protos-source.lock.json');
}

const configuredCache = process.env.PROTOS_SOURCE_CACHE;
const cache = configuredCache
  ? (isAbsolute(configuredCache) ? configuredCache : resolve(root, configuredCache))
  : join(root, '.protos-source');
const marker = join(cache, '.protos-revision');
const checkOnly = process.argv.includes('--check');

function run(args, options = {}) {
  return execFileSync(args[0], args.slice(1), {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })?.trim();
}

function cacheMatches() {
  if (!existsSync(marker)) return false;
  const recorded = readFileSync(marker, 'utf8').trim();
  if (recorded !== lock.revision) return false;
  for (const relative of lock.canonicalPaths) {
    if (!existsSync(join(cache, relative))) return false;
  }
  return true;
}

if (cacheMatches()) {
  console.log(`PROTOS_SOURCE_READY: ${lock.revision}`);
  process.exit(0);
}

if (checkOnly) {
  throw new Error(
    `Protos source cache is absent or does not match locked revision ${lock.revision}`,
  );
}

const temporary = `${cache}.tmp-${process.pid}`;
rmSync(temporary, { recursive: true, force: true });
rmSync(cache, { recursive: true, force: true });
mkdirSync(temporary, { recursive: true });

try {
  run(['git', 'init', '-q', temporary]);
  run(['git', '-C', temporary, 'remote', 'add', 'origin', lock.repository]);
  run([
    'git',
    '-C',
    temporary,
    'fetch',
    '--depth=1',
    '--filter=blob:none',
    'origin',
    lock.revision,
  ]);
  run(['git', '-C', temporary, 'sparse-checkout', 'init', '--cone']);
  run([
    'git',
    '-C',
    temporary,
    'sparse-checkout',
    'set',
    'docs/guide',
    'docs/design',
    'spec',
    'protos/tutorials',
    'protos/examples',
  ]);
  run(['git', '-C', temporary, 'checkout', '--detach', 'FETCH_HEAD']);

  const actual = run(
    ['git', '-C', temporary, 'rev-parse', 'HEAD'],
    { capture: true },
  );
  if (actual !== lock.revision) {
    throw new Error(`Protos revision mismatch: expected ${lock.revision}, got ${actual}`);
  }

  for (const relative of lock.canonicalPaths) {
    if (!existsSync(join(temporary, relative))) {
      throw new Error(`Canonical Protos source path missing: ${relative}`);
    }
  }

  writeFileSync(join(temporary, '.protos-revision'), `${actual}\n`, 'utf8');
  renameSync(temporary, cache);
  console.log(`PROTOS_SOURCE_FETCH: PASS revision=${actual}`);
} catch (error) {
  rmSync(temporary, { recursive: true, force: true });
  throw error;
}
