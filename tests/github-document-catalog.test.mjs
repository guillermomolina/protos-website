import test from 'node:test';
import assert from 'node:assert/strict';

import core from '../server/github-document-catalog-core.js';
import service from '../server/github-document-catalog-service.js';

const sha = (letter) => letter.repeat(40);

const snapshot = {
  schemaVersion: 1,
  repository: 'guillermomolina/protos',
  kind: 'development',
  ref: 'main',
  revision: sha('a'),
  treeSha: sha('b'),
  sourceUrl:
    `https://github.com/guillermomolina/protos/tree/${sha('a')}`,
};

const tree = (id, entries, truncated = false) => ({
  sha: id,
  truncated,
  tree: entries,
});

const folder = (path, id) => ({
  path,
  mode: '040000',
  type: 'tree',
  sha: id,
});

const file = (path, extra = {}) => ({
  path,
  mode: '100644',
  type: 'blob',
  sha: sha('c'),
  size: 100,
  ...extra,
});

const endpoint = (id, recursive = false) =>
  core.treeUrl(id, recursive);

function fixtures() {
  const urls = Object.create(null);

  urls[endpoint(sha('b'))] = tree(sha('b'), [
    folder('spec', sha('d')),
    folder('docs', sha('e')),
    folder('protos', sha('f')),
  ]);

  urls[endpoint(sha('e'))] = tree(sha('e'), [
    folder('guide', sha('1')),
  ]);

  urls[endpoint(sha('f'))] = tree(sha('f'), [
    folder('tutorials', sha('2')),
    folder('examples', sha('3')),
    folder('lib', sha('4')),
  ]);

  urls[endpoint(sha('d'), true)] = tree(sha('d'), [
    file('LANGUAGE.md'),
    file('sub/REFERENCE.md'),
    file('SECURITY.txt'),
  ]);

  urls[endpoint(sha('1'), true)] = tree(sha('1'), [
    file('00-try-protos.md'),
  ]);

  urls[endpoint(sha('2'), true)] = tree(sha('2'), [
    file('README.md'),
  ]);

  urls[endpoint(sha('3'), true)] = tree(sha('3'), [
    file('hello.protos'),
  ]);

  urls[endpoint(sha('4'), true)] = tree(sha('4'), [
    file('core/Array.protos'),
  ]);

  return urls;
}

async function build(urls = fixtures(), calls = []) {
  return service.createCatalog(
    snapshot,
    async (url, options) => {
      calls.push({ url, options });

      const value = urls[url];

      return {
        status: value === undefined ? 404 : 200,
        async text() {
          return JSON.stringify(value);
        },
      };
    },
  );
}

test('catalog binds all families to one exact Git tree', async () => {
  const calls = [];
  const result = await build(fixtures(), calls);

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.kind, 'canonical-document-catalog');
  assert.equal(result.revision, snapshot.revision);
  assert.equal(result.treeSha, snapshot.treeSha);
  assert.equal(result.entries.length, 6);

  assert.equal(
    result.entries.every(
      (item) => item.size === 100 &&
        item.blobSha === sha('c'),
    ),
    true,
  );

  assert.equal(calls.length, 8);

  assert.ok(calls.every((call) =>
    call.url.includes('/git/trees/') &&
    !call.url.includes('/main') &&
    !call.url.includes('v0.'),
  ));

  assert.ok(calls.every((call) =>
    call.options.method === 'GET',
  ));
});

test('root Git tree must match the snapshot', async () => {
  const values = fixtures();
  values[endpoint(sha('b'))].sha = sha('c');

  await assert.rejects(build(values));
});

test('missing subtree links fail closed', async () => {
  const values = fixtures();
  values[endpoint(sha('e'))].tree = [];

  await assert.rejects(build(values));
});

test('missing library subtree fails closed', async () => {
  const values = fixtures();

  values[endpoint(sha('f'))].tree =
    values[endpoint(sha('f'))].tree.filter(
      (entry) => entry.path !== 'lib',
    );

  await assert.rejects(build(values));
});

test('truncated recursive tree fails closed', async () => {
  const values = fixtures();
  values[endpoint(sha('1'), true)].truncated = true;

  await assert.rejects(build(values));
});

test('duplicate directory links are rejected', async () => {
  const values = fixtures();

  values[endpoint(sha('b'))].tree.push(
    folder('docs', sha('e')),
  );

  await assert.rejects(build(values));
});

test('duplicate document paths are rejected', async () => {
  const values = fixtures();

  values[endpoint(sha('1'), true)].tree.push(
    file('00-try-protos.md'),
  );

  await assert.rejects(build(values));
});

test('symlinks, oversized files and unsafe paths are excluded', async () => {
  const values = fixtures();

  values[endpoint(sha('d'), true)].tree.push(
    file('sneaky.md', { mode: '120000' }),
    file('oversized.md', { size: 131073 }),
    file('../outside.md'),
  );

  values[endpoint(sha('4'), true)].tree.push(
    file('unexpected.java'),
    file('../private.protos'),
    file('oversized.protos', { size: 131073 }),
  );

  const result = await build(values);

  assert.equal(result.entries.length, 6);
});

test('invalid canonical blob identity is rejected', async () => {
  const values = fixtures();

  values[endpoint(sha('1'), true)].tree[0].sha =
    'not-a-sha';

  await assert.rejects(build(values));
});

test('oversized upstream response fails closed', async () => {
  await assert.rejects(
    service.createCatalog(
      snapshot,
      async () => ({
        status: 200,
        async text() {
          return 'x'.repeat(core.MAX_UPSTREAM_CHARS + 1);
        },
      }),
    ),
  );
});

test('GitHub errors do not create a partial catalog', async () => {
  await assert.rejects(
    service.createCatalog(
      snapshot,
      async () => ({
        status: 403,
        async text() {
          throw new Error('Must not read error body');
        },
      }),
    ),
  );
});

test('catalog cannot exceed 512 admitted documents', async () => {
  const values = fixtures();

  values[endpoint(sha('1'), true)].tree =
    Array.from(
      { length: 513 },
      (_, index) => file(`document-${index}.md`),
    );

  await assert.rejects(build(values));
});

test('missing transport fails closed', async () => {
  await assert.rejects(
    service.createCatalog(snapshot, null),
  );
});
