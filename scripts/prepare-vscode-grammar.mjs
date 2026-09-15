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
const lockPath = join(root, 'protos-vscode-source.lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

if (
  lock.schemaVersion !== 1 ||
  typeof lock.repository !== 'string' ||
  typeof lock.revision !== 'string' ||
  !/^[0-9a-f]{40}$/.test(lock.revision) ||
  !Array.isArray(lock.canonicalPaths) ||
  lock.canonicalPaths.length !== 1 ||
  lock.canonicalPaths[0] !== 'syntaxes/protos.tmLanguage.json'
) {
  throw new Error('Invalid protos-vscode-source.lock.json');
}

const configuredCache = process.env.PROTOS_VSCODE_SOURCE_CACHE;
const cache = configuredCache
  ? (isAbsolute(configuredCache)
      ? configuredCache
      : resolve(root, configuredCache))
  : join(root, '.protos-vscode-source');

const marker = join(cache, '.protos-vscode-revision');
const grammar = join(cache, 'syntaxes/protos.tmLanguage.json');
const checkOnly = process.argv.includes('--check');

function run(args, options = {}) {
  return execFileSync(args[0], args.slice(1), {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })?.trim();
}

function grammarMatches() {
  if (!existsSync(grammar)) {
    return false;
  }

  try {
    const value = JSON.parse(readFileSync(grammar, 'utf8'));

    return (
      value.name === 'Protos' &&
      value.scopeName === 'source.protos' &&
      Array.isArray(value.patterns) &&
      value.patterns.length > 0 &&
      typeof value.repository === 'object' &&
      value.repository !== null
    );
  } catch {
    return false;
  }
}

function cacheMatches() {
  return (
    existsSync(marker) &&
    readFileSync(marker, 'utf8').trim() === lock.revision &&
    grammarMatches()
  );
}

if (checkOnly) {
  if (!cacheMatches()) {
    throw new Error(
      `VS Code grammar source is absent or does not match locked revision ${lock.revision}`,
    );
  }

  console.log(`PROTOS_VSCODE_SOURCE_READY: ${lock.revision}`);
  console.log(`PROTOS_GRAMMAR_READY: ${lock.revision}`);
  process.exit(0);
}

if (cacheMatches()) {
  console.log(`PROTOS_VSCODE_SOURCE_READY: ${lock.revision}`);
  console.log(`PROTOS_GRAMMAR_READY: ${lock.revision}`);
  process.exit(0);
}

const temporary = `${cache}.tmp-${process.pid}`;

rmSync(temporary, { recursive: true, force: true });
rmSync(cache, { recursive: true, force: true });
mkdirSync(temporary, { recursive: true });

try {
  run(['git', 'init', '-q', temporary]);
  run([
    'git',
    '-C',
    temporary,
    'remote',
    'add',
    'origin',
    lock.repository,
  ]);
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
    'syntaxes',
  ]);
  run(['git', '-C', temporary, 'checkout', '--detach', 'FETCH_HEAD']);

  const actual = run(
    ['git', '-C', temporary, 'rev-parse', 'HEAD'],
    { capture: true },
  );

  if (actual !== lock.revision) {
    throw new Error(
      `VS Code source revision mismatch: expected ${lock.revision}, got ${actual}`,
    );
  }

  for (const relative of lock.canonicalPaths) {
    if (!existsSync(join(temporary, relative))) {
      throw new Error(`Canonical VS Code source path missing: ${relative}`);
    }
  }

  writeFileSync(
    join(temporary, '.protos-vscode-revision'),
    `${actual}\n`,
    'utf8',
  );

  renameSync(temporary, cache);

  if (!grammarMatches()) {
    throw new Error(
      `Canonical Protos TextMate grammar is invalid at ${lock.revision}`,
    );
  }

  console.log(`PROTOS_VSCODE_SOURCE_FETCH: PASS revision=${actual}`);
  console.log(`PROTOS_GRAMMAR_READY: ${actual}`);
} catch (error) {
  rmSync(temporary, { recursive: true, force: true });
  throw error;
}
