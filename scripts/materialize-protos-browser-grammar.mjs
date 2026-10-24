import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(
  readFileSync(resolve(root, 'protos-vscode-source.lock.json'), 'utf8'),
);

const cache = process.env.PROTOS_VSCODE_SOURCE_CACHE
  ? resolve(process.env.PROTOS_VSCODE_SOURCE_CACHE)
  : '/tmp/protos-website-vscode-source';

const marker = resolve(cache, '.protos-vscode-revision');
const source = resolve(cache, 'syntaxes/protos.tmLanguage.json');
const target = resolve(
  root,
  'src/scripts/generated/protos-grammar.js',
);

if (
  !existsSync(marker) ||
  !existsSync(source) ||
  readFileSync(marker, 'utf8').trim() !== lock.revision
) {
  throw new Error('Protos VS Code grammar cache revision mismatch');
}

const canonical = JSON.parse(readFileSync(source, 'utf8'));

if (
  canonical.name !== 'Protos' ||
  canonical.scopeName !== 'source.protos' ||
  !Array.isArray(canonical.patterns) ||
  !canonical.patterns.length ||
  !canonical.repository
) {
  throw new Error('Invalid canonical Protos grammar');
}

// Adapt only renderer registration metadata.
// All lexical patterns remain the locked VS Code grammar.
const browserGrammar = {
  ...canonical,
  name: 'protos',
  aliases: ['Protos'],
};

const output = [
  `// Generated from Protos VS Code revision ${lock.revision}.`,
  '// Do not edit or maintain this grammar independently.',
  `export const PROTOS_GRAMMAR_REVISION = ${JSON.stringify(lock.revision)};`,
  `export default ${JSON.stringify(browserGrammar, null, 2)};`,
  '',
].join('\n');

const matches = existsSync(target) &&
  readFileSync(target, 'utf8') === output;

if (process.argv.includes('--check')) {
  if (!matches) {
    throw new Error('Browser grammar is absent or stale');
  }

  console.log(`PROTOS_BROWSER_GRAMMAR_CHECK=PASS revision=${lock.revision}`);
} else {
  if (!matches) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output, 'utf8');
  }

  console.log(`PROTOS_BROWSER_GRAMMAR_READY=${lock.revision}`);
}
