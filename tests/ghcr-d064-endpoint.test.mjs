import test from 'node:test';
import assert from 'node:assert/strict';

import handler from '../server/ghcr-d064.js';

const X = 'a'.repeat(40);

const LOCK = {
  schemaVersion: 1,
  kind: 'protos-d064-oci-lock',
  sourceRevision: X,
  d064ContentSha256: 'b'.repeat(64),
  d064ManifestDigest: 'sha256:' + 'c'.repeat(64),
};

const INDEX = {
  schemaVersion: 1,
  kind: 'protos-d064-publications',
  repository: 'guillermomolina/protos',
  activeRevision: X,
  publications: [LOCK],
};

const DOCUMENT = {
  provenance: {
    repository: 'guillermomolina/protos',
    revision: X,
  },
};

const CACHE = {
  get: () => null,
  add: () => true,
  set: () => true,
};

function request(method = 'GET', args = {}) {
  return {
    method,
    args,
    headersOut: {},
    status: null,
    payload: null,

    return(status, body) {
      this.status = status;
      this.payload = JSON.parse(body);
    },
  };
}

function fixture(overrides = {}) {
  const calls = {
    index: 0,
    document: 0,
    lock: null,
  };

  const dependencies = {
    metadataCache: CACHE,
    contentCache: CACHE,
    fetcher: async () => {
      throw new Error('Unexpected real transport');
    },
    sha256: async () => {
      throw new Error('Unexpected SHA invocation');
    },

    indexLoader: async () => {
      calls.index++;

      return {
        status: 200,
        state: 'fresh',
        index: INDEX,
        cache: 'MISS',
      };
    },

    documentLoader: async (lock) => {
      calls.document++;
      calls.lock = lock;

      return {
        status: 200,
        state: 'fresh',
        document: DOCUMENT,
        cache: 'MISS',
      };
    },
  };

  Object.assign(dependencies, overrides);

  return { dependencies, calls };
}

test('serves only the explicitly active X/H/M publication', async () => {
  const r = request();
  const f = fixture();

  await handler.serveDocument(r, f.dependencies);

  assert.equal(r.status, 200);
  assert.equal(r.payload.kind, 'protos-d064-publication');
  assert.equal(r.payload.state, 'fresh');
  assert.deepEqual(r.payload.publication, LOCK);
  assert.equal(r.payload.document.provenance.revision, X);
  assert.deepEqual(f.calls.lock, LOCK);
  assert.equal(f.calls.index, 1);
  assert.equal(f.calls.document, 1);
  assert.equal(
    r.headersOut['X-Protos-Cache'],
    'INDEX=MISS;DOCUMENT=MISS',
  );
  assert.equal(r.headersOut['Cache-Control'], 'no-store');
});

test('new active publication cannot silently use old revision', async () => {
  const nextRevision = 'd'.repeat(40);

  const nextLock = {
    ...LOCK,
    sourceRevision: nextRevision,
    d064ContentSha256: 'e'.repeat(64),
    d064ManifestDigest: 'sha256:' + 'f'.repeat(64),
  };

  const nextIndex = {
    ...INDEX,
    activeRevision: nextRevision,
    publications: [LOCK, nextLock],
  };

  const f = fixture({
    indexLoader: async () => ({
      status: 200,
      state: 'fresh',
      index: nextIndex,
      cache: 'MISS',
    }),
    documentLoader: async (lock) => {
      f.calls.lock = lock;

      return {
        status: 200,
        state: 'fresh',
        document: {
          provenance: {
            repository: 'guillermomolina/protos',
            revision: nextRevision,
          },
        },
        cache: 'MISS',
      };
    },
  });

  const r = request();

  await handler.serveDocument(r, f.dependencies);

  assert.equal(r.status, 200);
  assert.equal(r.payload.publication.sourceRevision, nextRevision);
  assert.equal(f.calls.lock.sourceRevision, nextRevision);
});

test('stale registry or stale D064 makes the response stale', async () => {
  for (const stalePart of ['index', 'document']) {
    const f = fixture({
      indexLoader: async () => ({
        status: 200,
        state: stalePart === 'index' ? 'stale' : 'fresh',
        index: INDEX,
        cache: stalePart === 'index' ? 'STALE' : 'HIT',
      }),
      documentLoader: async () => ({
        status: 200,
        state: stalePart === 'document' ? 'stale' : 'fresh',
        document: DOCUMENT,
        cache: stalePart === 'document' ? 'STALE' : 'HIT',
      }),
    });

    const r = request();

    await handler.serveDocument(r, f.dependencies);

    assert.equal(r.status, 200);
    assert.equal(r.payload.state, 'stale');
  }
});

test('non-GET requests are rejected before discovery', async () => {
  const r = request('POST');
  const f = fixture();

  await handler.serveDocument(r, f.dependencies);

  assert.equal(r.status, 405);
  assert.equal(r.headersOut.Allow, 'GET');
  assert.equal(f.calls.index, 0);
  assert.equal(f.calls.document, 0);
});

test('caller-selected revisions and URLs are rejected', async () => {
  for (const args of [
    { revision: X },
    { digest: LOCK.d064ContentSha256 },
    { url: 'https://example.invalid/document.json' },
  ]) {
    const r = request('GET', args);
    const f = fixture();

    await handler.serveDocument(r, f.dependencies);

    assert.equal(r.status, 400);
    assert.equal(f.calls.index, 0);
    assert.equal(f.calls.document, 0);
  }
});

test('missing cache or SHA dependencies fail before discovery', async () => {
  for (const replacement of [
    { metadataCache: null },
    { contentCache: null },
    { sha256: null },
    { fetcher: null },
  ]) {
    const r = request();
    const f = fixture(replacement);

    await handler.serveDocument(r, f.dependencies);

    assert.equal(r.status, 503);
    assert.equal(f.calls.index, 0);
    assert.equal(f.calls.document, 0);
  }
});

test('unavailable registry does not request D064', async () => {
  const r = request();
  const f = fixture({
    indexLoader: async () => ({
      status: 503,
      state: 'unavailable',
      index: null,
      cache: null,
    }),
  });

  await handler.serveDocument(r, f.dependencies);

  assert.equal(r.status, 503);
  assert.equal(f.calls.document, 0);
});

test('unavailable GHCR content fails without another publication', async () => {
  const r = request();
  const f = fixture({
    documentLoader: async () => ({
      status: 503,
      state: 'unavailable',
      document: null,
      cache: null,
    }),
  });

  await handler.serveDocument(r, f.dependencies);

  assert.equal(r.status, 503);
  assert.equal(r.payload.publication, null);
  assert.equal(r.payload.document, null);
});

test('document from a different revision is never served', async () => {
  const r = request();
  const f = fixture({
    documentLoader: async () => ({
      status: 200,
      state: 'fresh',
      cache: 'HIT',
      document: {
        provenance: {
          repository: 'guillermomolina/protos',
          revision: 'd'.repeat(40),
        },
      },
    }),
  });

  await handler.serveDocument(r, f.dependencies);

  assert.equal(r.status, 503);
  assert.equal(r.payload.document, null);
});

test('malformed discovery index is rejected', async () => {
  const r = request();
  const f = fixture({
    indexLoader: async () => ({
      status: 200,
      state: 'fresh',
      cache: 'HIT',
      index: {
        ...INDEX,
        activeRevision: 'd'.repeat(40),
      },
    }),
  });

  await handler.serveDocument(r, f.dependencies);

  assert.equal(r.status, 503);
  assert.equal(f.calls.document, 0);
});

test('internal transport errors are not disclosed', async () => {
  const r = request();
  const f = fixture({
    indexLoader: async () => {
      throw new Error('private-token-never-disclose');
    },
  });

  await handler.serveDocument(r, f.dependencies);

  assert.equal(r.status, 503);
  assert.equal(
    JSON.stringify(r.payload).includes('private-token'),
    false,
  );
});
