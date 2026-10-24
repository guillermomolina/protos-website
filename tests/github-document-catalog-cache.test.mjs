import test from 'node:test';
import assert from 'node:assert/strict';

import cacheService from '../server/github-document-catalog-cache.js';

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

const tree = (id, entries) => ({
  sha: id,
  truncated: false,
  tree: entries,
});

const directory = (path, id) => ({
  path,
  type: 'tree',
  mode: '040000',
  sha: id,
});

const file = (path) => ({
  path,
  type: 'blob',
  mode: '100644',
  sha: sha('c'),
  size: 100,
});

const url = (id, recursive = false) =>
  `https://api.github.com/repos/guillermomolina/protos/git/trees/${id}` +
  (recursive ? '?recursive=1' : '');

function trees() {
  const items = {};

  items[url(sha('b'))] = tree(sha('b'), [
    directory('spec', sha('d')),
    directory('docs', sha('e')),
    directory('protos', sha('f')),
  ]);

  items[url(sha('e'))] = tree(sha('e'), [
    directory('guide', sha('1')),
  ]);

  items[url(sha('f'))] = tree(sha('f'), [
    directory('tutorials', sha('2')),
    directory('examples', sha('3')),
    directory('lib', sha('4')),
  ]);

  items[url(sha('d'), true)] = tree(sha('d'), [
    file('LANGUAGE.md'),
  ]);

  items[url(sha('1'), true)] = tree(sha('1'), [
    file('00-try-protos.md'),
  ]);

  items[url(sha('2'), true)] = tree(sha('2'), [
    file('README.md'),
  ]);

  items[url(sha('3'), true)] = tree(sha('3'), [
    file('hello.protos'),
  ]);

  items[url(sha('4'), true)] = tree(sha('4'), [
    file('core/Array.protos'),
  ]);

  return items;
}

function fakeCache() {
  const values = new Map();
  const ttls = new Map();

  return {
    values,
    ttls,
    get(key) {
      return values.get(key);
    },
    set(key, value, ttl) {
      values.set(key, value);
      ttls.set(key, ttl);
      return true;
    },
    add(key, value, ttl) {
      if (values.has(key)) return false;
      values.set(key, value);
      ttls.set(key, ttl);
      return true;
    },
    delete(key) {
      values.delete(key);
      ttls.delete(key);
    },
  };
}

function fetcher(treeData, calls = []) {
  return async (endpoint) => {
    calls.push(endpoint);

    const response = treeData[endpoint];

    return {
      status: response ? 200 : 404,
      async text() {
        return JSON.stringify(response);
      },
    };
  };
}

const prefix = `docs:catalog:${sha('a')}:`;

test('cold MISS then HIT requires only eight GitHub requests', async () => {
  const cache = fakeCache();
  const calls = [];
  const dependencies = {
    cache,
    fetcher: fetcher(trees(), calls),
  };

  const first = await cacheService.loadCatalog(
    snapshot, dependencies,
  );

  const second = await cacheService.loadCatalog(
    snapshot, dependencies,
  );

  assert.equal(first.status, 200);
  assert.equal(first.cache, 'MISS');
  assert.equal(first.state, 'fresh');
  assert.equal(first.catalog.entries.length, 5);

  assert.equal(second.status, 200);
  assert.equal(second.cache, 'HIT');
  assert.equal(second.state, 'fresh');

  assert.equal(calls.length, 8);
  assert.deepEqual(second.catalog, first.catalog);

  assert.equal(cache.ttls.get(prefix + 'fresh'), 900000);
  assert.equal(cache.ttls.get(prefix + 'stale'), 86400000);
});

test('cached documents retain the commit and Git tree identity', async () => {
  const cache = fakeCache();

  const first = await cacheService.loadCatalog(snapshot, {
    cache,
    fetcher: fetcher(trees()),
  });

  assert.equal(first.catalog.revision, snapshot.revision);
  assert.equal(first.catalog.treeSha, snapshot.treeSha);

  const second = await cacheService.loadCatalog(snapshot, {
    cache,
  });

  assert.equal(second.cache, 'HIT');
  assert.equal(second.catalog.entries.length, 5);
});

test('different commit SHA cannot reuse the original cache', async () => {
  const cache = fakeCache();

  await cacheService.loadCatalog(snapshot, {
    cache,
    fetcher: fetcher(trees()),
  });

  const newer = {
    ...snapshot,
    revision: sha('9'),
    sourceUrl:
      `https://github.com/guillermomolina/protos/tree/${sha('9')}`,
  };

  const result = await cacheService.loadCatalog(newer, {
    cache,
  });

  assert.equal(result.status, 503);
  assert.equal(result.catalog, null);
});

test('stale catalog survives an upstream failure', async () => {
  const cache = fakeCache();

  await cacheService.loadCatalog(snapshot, {
    cache,
    fetcher: fetcher(trees()),
  });

  cache.delete(prefix + 'fresh');

  let calls = 0;

  const dependencies = {
    cache,
    fetcher: async () => {
      calls++;
      throw new Error('GitHub unavailable');
    },
  };

  const first = await cacheService.loadCatalog(
    snapshot, dependencies,
  );

  const second = await cacheService.loadCatalog(
    snapshot, dependencies,
  );

  assert.equal(first.status, 200);
  assert.equal(first.state, 'stale');
  assert.equal(first.cache, 'STALE');
  assert.equal(second.cache, 'STALE');
  assert.equal(calls, 1);
  assert.equal(cache.ttls.get(prefix + 'backoff'), 60000);
});

test('empty cache fails closed when transport is unavailable', async () => {
  const result = await cacheService.loadCatalog(snapshot, {
    cache: fakeCache(),
  });

  assert.equal(result.status, 503);
  assert.equal(result.state, 'unavailable');
  assert.equal(result.catalog, null);
});

test('missing shared cache prevents GitHub access', async () => {
  let calls = 0;

  const result = await cacheService.loadCatalog(snapshot, {
    fetcher: async () => {
      calls++;
      throw new Error('Unexpected request');
    },
  });

  assert.equal(result.status, 503);
  assert.equal(calls, 0);
});

test('an active lease prevents concurrent rebuilding', async () => {
  const cache = fakeCache();

  cache.add(prefix + 'fetching', '1', 60000);

  let calls = 0;

  const result = await cacheService.loadCatalog(snapshot, {
    cache,
    fetcher: async () => {
      calls++;
      throw new Error('Unexpected request');
    },
  });

  assert.equal(result.status, 503);
  assert.equal(calls, 0);
});

test('a rebuilding lease is released after success', async () => {
  const cache = fakeCache();

  await cacheService.loadCatalog(snapshot, {
    cache,
    fetcher: fetcher(trees()),
  });

  assert.equal(cache.get(prefix + 'fetching'), undefined);
});

test('rate limiting triggers backoff without caching invalid data', async () => {
  const cache = fakeCache();

  const result = await cacheService.loadCatalog(snapshot, {
    cache,
    fetcher: async () => ({
      status: 403,
      async text() {
        throw new Error('Must not read 403 body');
      },
    }),
  });

  assert.equal(result.status, 503);
  assert.equal(cache.get(prefix + 'backoff'), '1');
  assert.equal(cache.get(prefix + 'fresh'), undefined);
});

test('truncated trees do not produce cached catalogues', async () => {
  const cache = fakeCache();
  const data = trees();

  data[url(sha('1'), true)].truncated = true;

  const result = await cacheService.loadCatalog(snapshot, {
    cache,
    fetcher: fetcher(data),
  });

  assert.equal(result.status, 503);
  assert.equal(cache.get(prefix + 'fresh'), undefined);
  assert.equal(cache.get(prefix + 'stale'), undefined);
});

test('corrupt cached values are never returned', async () => {
  const cache = fakeCache();

  cache.set(
    prefix + 'fresh',
    '{"revision":"bad"}',
    900000,
  );

  const result = await cacheService.loadCatalog(snapshot, {
    cache,
    fetcher: fetcher(trees()),
  });

  assert.equal(result.status, 200);
  assert.equal(result.cache, 'MISS');
  assert.equal(result.catalog.revision, snapshot.revision);
});

test('cached catalog with wrong tree SHA is rejected', async () => {
  const cache = fakeCache();

  const original = await cacheService.loadCatalog(snapshot, {
    cache,
    fetcher: fetcher(trees()),
  });

  cache.set(
    prefix + 'fresh',
    JSON.stringify({
      ...original.catalog,
      treeSha: sha('9'),
    }),
    900000,
  );

  const result = await cacheService.loadCatalog(snapshot, {
    cache,
  });

  assert.equal(result.status, 200);
  assert.equal(result.cache, 'STALE');
  assert.equal(result.catalog.treeSha, snapshot.treeSha);
});

test('invalid source documents are rejected during cache admission', async () => {
  const cache = fakeCache();

  cache.set(
    prefix + 'fresh',
    JSON.stringify({
      schemaVersion: 1,
      kind: 'canonical-document-catalog',
      repository: 'guillermomolina/protos',
      revision: snapshot.revision,
      treeSha: snapshot.treeSha,
      entries: [{
        family: 'guide',
        path: 'docs/guide/../secret.md',
        type: 'blob',
        blobSha: sha('c'),
        size: 100,
      }],
    }),
    900000,
  );

  const result = await cacheService.loadCatalog(snapshot, {
    cache,
  });

  assert.equal(result.status, 503);
});

test('oversized cached values are rejected', async () => {
  const cache = fakeCache();

  cache.set(
    prefix + 'fresh',
    'x'.repeat(200001),
    900000,
  );

  const result = await cacheService.loadCatalog(snapshot, {
    cache,
  });

  assert.equal(result.status, 503);
});

test('invalid snapshot fails before accessing GitHub', async () => {
  let calls = 0;

  await assert.rejects(() =>
    cacheService.loadCatalog(
      { ...snapshot, revision: 'main' },
      {
        cache: fakeCache(),
        fetcher: async () => {
          calls++;
        },
      },
    ),
  );

  assert.equal(calls, 0);
});

test('cache service exposes only admission and loading', () => {
  assert.deepEqual(
    Object.keys(cacheService),
    ['validateCatalog', 'loadCatalog'],
  );
});
