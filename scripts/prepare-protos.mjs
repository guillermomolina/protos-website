import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  materializeProtosGuide,
  protosGuideMatchesSource,
} from './materialize-protos-guide.mjs';
import {
  materializeProtosTutorials,
  protosTutorialsMatchSource,
} from './materialize-protos-tutorials.mjs';
import {
  materializeProtosExamples,
  protosExamplesMatchSource,
} from './materialize-protos-examples.mjs';

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
const brandingSourceDirectory = join(cache, 'docs/assets/branding');
const brandingOutputDirectory = join(root, 'public/protos-branding');
const brandingFiles = ['protos-logo.png', 'protos-symbol.png'];
const protosGrammarSource = join(
  cache,
  'editors/vscode/syntaxes/protos.tmLanguage.json',
);

function protosGrammarSourceMatches() {
  if (!existsSync(protosGrammarSource)) return false;

  try {
    const grammar = JSON.parse(readFileSync(protosGrammarSource, 'utf8'));
    return (
      grammar.name === 'Protos' &&
      grammar.scopeName === 'source.protos' &&
      Array.isArray(grammar.patterns) &&
      grammar.patterns.length > 0 &&
      typeof grammar.repository === 'object' &&
      grammar.repository !== null
    );
  } catch {
    return false;
  }
}

function requireProtosGrammarSource() {
  if (!protosGrammarSourceMatches()) {
    throw new Error(
      `Canonical Protos TextMate grammar does not match locked revision ${lock.revision}`,
    );
  }
}

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

function brandingMatchesSource() {
  for (const name of brandingFiles) {
    const source = join(brandingSourceDirectory, name);
    const output = join(brandingOutputDirectory, name);
    if (!existsSync(source) || !existsSync(output)) return false;
    if (!readFileSync(source).equals(readFileSync(output))) return false;
  }
  return true;
}

function materializeBranding() {
  for (const name of brandingFiles) {
    if (!existsSync(join(brandingSourceDirectory, name))) {
      throw new Error(`Canonical Protos branding asset missing: ${name}`);
    }
  }

  if (brandingMatchesSource()) {
    console.log(`PROTOS_BRANDING_READY: ${lock.revision}`);
    return;
  }

  const temporaryBranding = `${brandingOutputDirectory}.tmp-${process.pid}`;
  rmSync(temporaryBranding, { recursive: true, force: true });
  mkdirSync(temporaryBranding, { recursive: true });

  try {
    for (const name of brandingFiles) {
      copyFileSync(
        join(brandingSourceDirectory, name),
        join(temporaryBranding, name),
      );
    }
    rmSync(brandingOutputDirectory, { recursive: true, force: true });
    mkdirSync(dirname(brandingOutputDirectory), { recursive: true });
    renameSync(temporaryBranding, brandingOutputDirectory);
    console.log(`PROTOS_BRANDING_MATERIALIZED: ${lock.revision}`);
  } catch (error) {
    rmSync(temporaryBranding, { recursive: true, force: true });
    throw error;
  }
}

if (cacheMatches()) {
  requireProtosGrammarSource();

  if (checkOnly) {
    if (!brandingMatchesSource()) {
      throw new Error(
        `Generated Protos branding does not match locked revision ${lock.revision}`,
      );
    }
    if (!protosGuideMatchesSource({ root, cache, lock })) {
      throw new Error(
        `Generated Protos guide does not match locked revision ${lock.revision}`,
      );
    }
    if (!protosTutorialsMatchSource({ root, cache, lock })) {
      throw new Error(
        `Generated Protos tutorials do not match locked revision ${lock.revision}`,
      );
    }
    if (!protosExamplesMatchSource({ root, cache, lock })) {
      throw new Error(
        `Generated Protos examples do not match locked revision ${lock.revision}`,
      );
    }
    console.log(`PROTOS_SOURCE_READY: ${lock.revision}`);
    console.log(`PROTOS_BRANDING_READY: ${lock.revision}`);
    console.log(`PROTOS_GUIDE_READY: ${lock.revision}`);
    console.log(`PROTOS_TUTORIALS_READY: ${lock.revision}`);
    console.log(`PROTOS_EXAMPLES_READY: ${lock.revision}`);
    console.log(`PROTOS_GRAMMAR_READY: ${lock.revision}`);
    process.exit(0);
  }

  materializeBranding();
  materializeProtosGuide({ root, cache, lock });
  materializeProtosTutorials({ root, cache, lock });
  materializeProtosExamples({ root, cache, lock });
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
    'docs/assets/branding',
    'spec',
    'protos/tutorials',
    'protos/examples',
    'editors/vscode/syntaxes',
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
  requireProtosGrammarSource();
  materializeBranding();
  materializeProtosGuide({ root, cache, lock });
  materializeProtosTutorials({ root, cache, lock });
  materializeProtosExamples({ root, cache, lock });
  console.log(`PROTOS_SOURCE_FETCH: PASS revision=${actual}`);
} catch (error) {
  rmSync(temporary, { recursive: true, force: true });
  throw error;
}
