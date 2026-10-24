import test from 'node:test';
import assert from 'node:assert/strict';

import revisionCore from '../server/github-document-revision-core.js';
import sourceCore from '../server/github-document-source-core.js';
import contentCache from '../server/github-document-content-cache.js';

const SHA = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const BLOB = 'c'.repeat(40);
const REPOSITORY = 'guillermomolina/protos';

function fixture(revision = SHA, relativePath = 'LANGUAGE.md') {
  const snapshot = {
    schemaVersion: 1,
    repository: REPOSITORY,
    kind: 'development',
    ref: 'main',
    revision,
    treeSha: TREE,
    sourceUrl:
      `https://github.com/${REPOSITORY}/tree/${revision}`,
  };

  const location = revisionCore.canonicalDocument(
    snapshot,
    'spec',
    relativePath,
  );

  const catalog = {
    schemaVersion: 1,
    kind: 'canonical-document-catalog',
    repository: REPOSITORY,
    revision,
    treeSha: TREE,
    entries: [{
      family: 'spec',
      path: location.path,
      type: 'blob',
      blobSha: BLOB,
      size: 100,
    }],
  };

  return {
    snapshot,
    catalog,
    family: 'spec',
    relativePath,
  };
}

function memoryCache() {
  const values = new Map();
  const times = new Map();

  return {
    values,
    times,

    get(key) {
      return values.get(key);
    },

    set(key, value, ttl) {
      values.set(key, value);
      times.set(key, ttl);
      return true;
    },

    add(key, value, ttl) {
      if (values.has(key)) {
        return false;
      }

      values.set(key, value);
      times.set(key, ttl);
      return true;
    },

    delete(key) {
      values.delete(key);
      times.delete(key);
    },
  };
}

function descriptor(selection) {
  return sourceCore.selectDocument(
    selection.snapshot,
    selection.catalog,
    selection.family,
    selection.relativePath,
  );
}

function prefix(selection) {
  const selected = descriptor(selection);

  return [
    'docs:content',
    selected.revision,
    selected.blobSha,
    selected.family,
    selected.path,
  ].join(':');
}

function transport(body = '# Language\n', calls = []) {
  return async (url, options) => {
    calls.push({ url, options });

    return {
      status: 200,
      async text() {
        return body;
      },
    };
  };
}

function dependencies(fetcher, metadataCache, documentCache) {
  return {
    fetcher,
    metadataCache,
    contentCache: documentCache,
  };
}

test('cold MISS then HIT uses one exact-revision fetch', async () => {
  const selected = fixture();
  const metadata = memoryCache();
  const documents = memoryCache();
  const calls = [];

  const deps = dependencies(
    transport('# Language\n', calls),
    metadata,
    documents,
  );

  const first = await contentCache.loadDocument(
    selected,
    deps,
  );

  const second = await contentCache.loadDocument(
    selected,
    deps,
  );

  assert.equal(first.status, 200);
  assert.equal(first.state, 'fresh');
  assert.equal(first.cache, 'MISS');
  assert.equal(second.status, 200);
  assert.equal(second.cache, 'HIT');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, descriptor(selected).rawUrl);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(
    calls[0].options.max_response_body_size,
    262144,
  );

  assert.equal(first.document.revision, SHA);
  assert.equal(first.document.treeSha, TREE);
  assert.equal(first.document.path, descriptor(selected).path);

  assert.equal(
    metadata.times.get(`${prefix(selected)}:fresh`),
    900000,
  );

  assert.equal(
    documents.times.get(`${prefix(selected)}:data`),
    86400000,
  );
});

test('document bodies are isolated from metadata cache', async () => {
  const selected = fixture();
  const metadata = memoryCache();
  const documents = memoryCache();

  await contentCache.loadDocument(
    selected,
    dependencies(transport(), metadata, documents),
  );

  assert.equal(
    metadata.get(`${prefix(selected)}:data`),
    undefined,
  );

  assert.equal(
    typeof documents.get(`${prefix(selected)}:data`),
    'string',
  );
});

test('different commit SHA cannot reuse cached content', async () => {
  const metadata = memoryCache();
  const documents = memoryCache();
  const calls = [];

  const deps = dependencies(
    transport('# Language\n', calls),
    metadata,
    documents,
  );

  const original = fixture();
  const changed = fixture('d'.repeat(40));

  const first = await contentCache.loadDocument(
    original,
    deps,
  );

  const second = await contentCache.loadDocument(
    changed,
    deps,
  );

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.cache, 'MISS');
  assert.equal(second.cache, 'MISS');
  assert.equal(calls.length, 2);

  assert.equal(second.document.revision, 'd'.repeat(40));

  assert.notEqual(
    calls[0].url,
    calls[1].url,
  );
});

test('missing cache fails closed before fetching', async () => {
  let calls = 0;

  const result = await contentCache.loadDocument(
    fixture(),
    {
      fetcher() {
        calls++;
        throw new Error('Must not fetch');
      },
    },
  );

  assert.equal(result.status, 503);
  assert.equal(result.document, null);
  assert.equal(calls, 0);
});

test('document absent from catalog is never fetched', async () => {
  const selected = fixture();
  selected.relativePath = 'missing.md';

  let calls = 0;

  await assert.rejects(() =>
    contentCache.loadDocument(
      selected,
      dependencies(
        () => {
          calls++;
          throw new Error('Must not fetch');
        },
        memoryCache(),
        memoryCache(),
      ),
    ),
  );

  assert.equal(calls, 0);
});

test('path traversal fails before cache or transport', async () => {
  const selected = fixture();
  selected.relativePath = '../private.md';

  const metadata = memoryCache();
  const documents = memoryCache();

  await assert.rejects(() =>
    contentCache.loadDocument(
      selected,
      dependencies(
        transport(),
        metadata,
        documents,
      ),
    ),
  );

  assert.equal(metadata.values.size, 0);
  assert.equal(documents.values.size, 0);
});

test('upstream failure preserves stale and starts backoff', async () => {
  const selected = fixture();
  const metadata = memoryCache();
  const documents = memoryCache();

  await contentCache.loadDocument(
    selected,
    dependencies(
      transport('# Original\n'),
      metadata,
      documents,
    ),
  );

  metadata.delete(`${prefix(selected)}:fresh`);

  let calls = 0;

  const offline = dependencies(
    async () => {
      calls++;
      throw new Error('Offline');
    },
    metadata,
    documents,
  );

  const first = await contentCache.loadDocument(
    selected,
    offline,
  );

  const second = await contentCache.loadDocument(
    selected,
    offline,
  );

  assert.equal(first.status, 200);
  assert.equal(first.state, 'stale');
  assert.equal(first.cache, 'STALE');
  assert.equal(first.document.content, '# Original\n');

  assert.equal(second.status, 200);
  assert.equal(second.cache, 'STALE');
  assert.equal(calls, 1);

  assert.equal(
    metadata.times.get(`${prefix(selected)}:backoff`),
    60000,
  );
});

test('cold upstream failure returns 503 with backoff', async () => {
  const selected = fixture();
  const metadata = memoryCache();
  const documents = memoryCache();

  const result = await contentCache.loadDocument(
    selected,
    dependencies(
      async () => ({
        status: 404,
        async text() {
          throw new Error('Must not read failure body');
        },
      }),
      metadata,
      documents,
    ),
  );

  assert.equal(result.status, 503);
  assert.equal(result.state, 'unavailable');
  assert.equal(result.document, null);

  assert.equal(
    metadata.get(`${prefix(selected)}:backoff`),
    '1',
  );

  assert.equal(documents.values.size, 0);
});

test('active lease prevents concurrent cold fetches', async () => {
  const selected = fixture();
  const metadata = memoryCache();
  const documents = memoryCache();

  metadata.set(
    `${prefix(selected)}:fetching`,
    '1',
    20000,
  );

  let calls = 0;

  const result = await contentCache.loadDocument(
    selected,
    dependencies(
      () => {
        calls++;
        throw new Error('Must not fetch');
      },
      metadata,
      documents,
    ),
  );

  assert.equal(result.status, 503);
  assert.equal(calls, 0);
});

test('an active lease preserves valid stale content', async () => {
  const selected = fixture();
  const metadata = memoryCache();
  const documents = memoryCache();

  await contentCache.loadDocument(
    selected,
    dependencies(
      transport('# Cached\n'),
      metadata,
      documents,
    ),
  );

  metadata.delete(`${prefix(selected)}:fresh`);

  metadata.set(
    `${prefix(selected)}:fetching`,
    '1',
    20000,
  );

  const result = await contentCache.loadDocument(
    selected,
    dependencies(
      () => {
        throw new Error('Must not fetch');
      },
      metadata,
      documents,
    ),
  );

  assert.equal(result.status, 200);
  assert.equal(result.state, 'stale');
  assert.equal(result.document.content, '# Cached\n');
});

test('forged cached document is not returned', async () => {
  const selected = fixture();
  const metadata = memoryCache();
  const documents = memoryCache();

  const bad = {
    schemaVersion: 1,
    blobSha: 'f'.repeat(40),
    document: {
      content: 'Forged',
      revision: 'f'.repeat(40),
    },
  };

  documents.set(
    `${prefix(selected)}:data`,
    JSON.stringify(bad),
    86400000,
  );

  metadata.set(
    `${prefix(selected)}:fresh`,
    '1',
    900000,
  );

  const result = await contentCache.loadDocument(
    selected,
    dependencies(
      transport('# Correct\n'),
      metadata,
      documents,
    ),
  );

  assert.equal(result.status, 200);
  assert.equal(result.cache, 'MISS');
  assert.equal(result.document.revision, SHA);
  assert.equal(result.document.content, '# Correct\n');
});

test('evicted content is fetched despite a fresh marker', async () => {
  const selected = fixture();
  const metadata = memoryCache();
  const documents = memoryCache();

  let calls = 0;

  const deps = dependencies(
    async (url, options) => {
      calls++;

      return {
        status: 200,
        async text() {
          return '# Language\n';
        },
      };
    },
    metadata,
    documents,
  );

  await contentCache.loadDocument(selected, deps);

  documents.delete(`${prefix(selected)}:data`);

  const result = await contentCache.loadDocument(
    selected,
    deps,
  );

  assert.equal(result.status, 200);
  assert.equal(result.cache, 'MISS');
  assert.equal(calls, 2);
});

test('raw markup remains inert source text', async () => {
  const source = '<script>alert(1)</script>';

  const result = await contentCache.loadDocument(
    fixture(),
    dependencies(
      transport(source),
      memoryCache(),
      memoryCache(),
    ),
  );

  assert.equal(result.status, 200);
  assert.equal(result.document.content, source);
  assert.equal(result.document.contentKind, 'markdown');
});

test('oversized document never enters cache', async () => {
  const selected = fixture();
  const metadata = memoryCache();
  const documents = memoryCache();

  const result = await contentCache.loadDocument(
    selected,
    dependencies(
      transport('x'.repeat(131073)),
      metadata,
      documents,
    ),
  );

  assert.equal(result.status, 503);
  assert.equal(result.document, null);
  assert.equal(documents.values.size, 0);
});

test('cache write failure enables backoff', async () => {
  const selected = fixture();
  const metadata = memoryCache();
  const documents = memoryCache();

  documents.set = () => false;

  const result = await contentCache.loadDocument(
    selected,
    dependencies(
      transport(),
      metadata,
      documents,
    ),
  );

  assert.equal(result.status, 503);
  assert.equal(
    metadata.get(`${prefix(selected)}:backoff`),
    '1',
  );
});

test('stale data survives unavailable fetch transport', async () => {
  const selected = fixture();
  const metadata = memoryCache();
  const documents = memoryCache();

  await contentCache.loadDocument(
    selected,
    dependencies(
      transport('# Saved\n'),
      metadata,
      documents,
    ),
  );

  metadata.delete(`${prefix(selected)}:fresh`);

  const result = await contentCache.loadDocument(
    selected,
    dependencies(
      null,
      metadata,
      documents,
    ),
  );

  assert.equal(result.status, 200);
  assert.equal(result.state, 'stale');
  assert.equal(result.document.content, '# Saved\n');
});

test('only explicit document loading is exported', () => {
  assert.deepEqual(
    Object.keys(contentCache),
    ['loadDocument'],
  );
});
