import test from 'node:test';
import assert from 'node:assert/strict';

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  retireGeneratedNews,
} from '../scripts/retire-generated-news.mjs';

function tempRoot(t) {
  const root = mkdtempSync(
    join(tmpdir(), 'web011-retired-news-'),
  );

  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  return root;
}

function legacy(root) {
  const directory = join(
    root, 'src/content/docs/community/news',
  );

  const manifest = join(
    root, 'src/generated/protos-news.json',
  );

  mkdirSync(directory, { recursive: true });
  mkdirSync(join(root, 'src/generated'), {
    recursive: true,
  });

  writeFileSync(join(directory, 'index.md'), 'old index');
  writeFileSync(
    join(directory, '2026-10-22-release.md'),
    'old article',
  );
  writeFileSync(manifest, '{}');

  return { directory, manifest };
}

test('removes recognized legacy news output', t => {
  const root = tempRoot(t);
  const paths = legacy(root);

  retireGeneratedNews({ root });

  assert.equal(existsSync(paths.directory), false);
  assert.equal(existsSync(paths.manifest), false);
});

test('cleanup is idempotent', t => {
  const root = tempRoot(t);

  retireGeneratedNews({ root });
  retireGeneratedNews({ root });
});

test('check mode rejects old output without deletion', t => {
  const root = tempRoot(t);
  const paths = legacy(root);

  assert.throws(
    () => retireGeneratedNews({ root, checkOnly: true }),
    /Retired news output still exists/,
  );

  assert.equal(existsSync(paths.directory), true);
  assert.equal(existsSync(paths.manifest), true);
});

test('check mode accepts clean source', t => {
  const root = tempRoot(t);

  assert.doesNotThrow(
    () => retireGeneratedNews({ root, checkOnly: true }),
  );
});

test('unexpected files prevent partial deletion', t => {
  const root = tempRoot(t);
  const paths = legacy(root);
  const extra = join(paths.directory, 'personal-note.md');

  writeFileSync(extra, 'preserve');

  assert.throws(
    () => retireGeneratedNews({ root }),
    /Unexpected legacy news file/,
  );

  assert.equal(existsSync(extra), true);
  assert.equal(existsSync(paths.manifest), true);
});

test('preparation no longer generates news', () => {
  const source = readFileSync(
    'scripts/prepare-protos.mjs', 'utf8',
  );

  assert.doesNotMatch(source, /materializeProtosNews/);
  assert.doesNotMatch(source, /protosNewsMatchesSource/);
  assert.doesNotMatch(source, /['"]docs\/news['"]/);
  assert.match(source, /retireGeneratedNews/);

  assert.equal(
    existsSync('scripts/materialize-protos-news.mjs'),
    false,
  );
});

test('source lock no longer requires docs/news', () => {
  const lock = JSON.parse(
    readFileSync('protos-source.lock.json', 'utf8'),
  );

  assert.equal(
    lock.canonicalPaths.includes('docs/news'),
    false,
  );
});

test('Docker ignores retired news output', () => {
  const source = readFileSync('.dockerignore', 'utf8');

  assert.match(
    source,
    /^src\/content\/docs\/community\/news$/m,
  );

  assert.match(
    source,
    /^src\/generated\/protos-news\.json$/m,
  );
});
