// WEB010: retire ignored exact-SHA Astro source copies on every dev/build.
// Live docs resolve Protos/main via the existing verified NGINX endpoints.
// The curated index pages, logos and historical changelog are NOT generated.
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const candidates = [];

function add(relative) {
  const absolute = join(root, relative);
  if (!existsSync(absolute)) return;
  if (lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`Refusing symbolic link at ${relative}`);
  }
  candidates.push({ relative, absolute });
}

function children(directory, predicate) {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return;
  if (!lstatSync(absolute).isDirectory()) {
    throw new Error(`Unexpected source directory: ${directory}`);
  }
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (predicate(entry.name, entry)) add(`${directory}/${entry.name}`);
  }
}

const guide = 'src/content/docs/learn/guide';
children(guide, (name, entry) =>
  (entry.isFile() && (/^\d{2}-[a-z0-9-]+\.md$/.test(name) ||
    name === 'source-style.md' || name === 'first-program.md')) ||
  (entry.isDirectory() &&
    ['tools', 'library', 'interop', 'embedding'].includes(name))
);
children('src/content/docs/learn/tutorials', (name, entry) =>
  entry.isDirectory() && /^\d{2}-[a-z0-9-]+$/.test(name)
);
for (const name of ['catalog', 'programs']) {
  add(`src/content/docs/learn/examples/${name}`);
}
for (const name of [
  'specification', 'grammar', 'semantics', 'concurrency', 'io', 'runtime',
]) {
  add(`src/content/docs/reference/language/${name}`);
}
for (const name of ['source', 'api']) {
  add(`src/content/docs/reference/standard-library/${name}`);
}

if (checkOnly && candidates.length > 0) {
  throw new Error('Retired Protos static outputs remain: ' +
    candidates.map(x => x.relative).join(', '));
}
for (const item of candidates) {
  rmSync(item.absolute, { recursive: true, force: true });
  console.log(`WEB010_RETIRED_STATIC=${item.relative}`);
}
console.log('WEB010_STATIC_CONTENT=' +
  (checkOnly ? 'CLEAN' : `CLEANED count=${candidates.length}`));
