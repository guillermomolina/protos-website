import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import cacheService from '../server/ghcr-d064-content-cache.js';
import transportService from '../server/ghcr-d064-service.js';

const X = 'a'.repeat(40);
const TOKEN = 'public-read-token.0123456789';
const CDN =
  'https://pkg-containers.githubusercontent.com/ghcr1/blobs/test' +
  '?signature=fixture';

function digest(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

async function sha256(bytes) {
  return digest(bytes);
}

function fixture() {
  const document = Buffer.from(JSON.stringify({
    format: {
      name: 'protos-documentation',
      major: 1,
      minor: 0,
    },
    provenance: {
      kind: 'repositoryRevision',
      repository: 'guillermomolina/protos',
      revision: X,
    },
    modules: [],
    symbols: [],
    articles: [],
    relationships: [],
  }));

  const H = digest(document);

  const manifest = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    artifactType: 'application/vnd.protos.stdlib-documentation.v1',
    config: {
      mediaType: 'application/vnd.oci.empty.v1+json',
      digest:
        'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
      size: 2,
    },
    layers: [{
      mediaType: 'application/vnd.protos.stdlib-documentation.v1+json',
      digest: `sha256:${H}`,
      size: document.length,
      annotations: {
        'org.opencontainers.image.title': 'stdlib-documentation.json',
      },
    }],
    annotations: {
      'org.opencontainers.image.revision': X,
      'org.opencontainers.image.source':
        'https://github.com/guillermomolina/protos',
    },
  }));

  const M = digest(manifest);

  return {
    document,
    manifest,
    lock: {
      schemaVersion: 1,
      kind: 'protos-d064-oci-lock',
      sourceRevision: X,
      d064ContentSha256: H,
      d064ManifestDigest: `sha256:${M}`,
    },
  };
}

function reply(status, data = '', headers = {}) {
  const bytes = Buffer.from(data);
  const normalized = Object.create(null);

  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }

  return {
    status,
    headers: {
      get(name) {
        return normalized[name.toLowerCase()] ?? null;
      },
    },
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer;
    },
  };
}

function upstream(f) {
  let requests = 0;
  let broken = false;

  const registryApi = transportService.REGISTRY_API;
  const manifestUrl =
    `${registryApi}/manifests/${f.lock.d064ManifestDigest}`;
  const blobUrl =
    `${registryApi}/blobs/sha256:${f.lock.d064ContentSha256}`;

  async function fetcher(url) {
    requests++;

    if (broken) {
      throw new Error('GHCR unavailable');
    }

    if (url === transportService.TOKEN_URL) {
      return reply(200, JSON.stringify({ token: TOKEN }));
    }

    if (url === manifestUrl) {
      return reply(200, f.manifest);
    }

    if (url === blobUrl) {
      return reply(307, '', { Location: CDN });
    }

    if (url === CDN) {
      return reply(200, f.document);
    }

    throw new Error('Unexpected external URL');
  }

  return {
    fetcher,
    requests: () => requests,
    fail: () => { broken = true; },
  };
}

function caches() {
  let now = 0;

  function create() {
    const entries = new Map();

    function get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;

      if (entry.until <= now) {
        entries.delete(key);
        return undefined;
      }

      return entry.value;
    }

    function set(key, value, ttl) {
      entries.set(key, {
        value,
        until: now + ttl,
      });
      return true;
    }

    function add(key, value, ttl) {
      if (get(key) !== undefined) return false;
      return set(key, value, ttl);
    }

    return {
      get,
      set,
      add,
      delete: (key) => entries.delete(key),
    };
  }

  return {
    metadataCache: create(),
    contentCache: create(),
    advance: (ms) => { now += ms; },
  };
}

function cacheName(lock) {
  return [
    'd064:content',
    lock.sourceRevision,
    lock.d064ContentSha256,
    lock.d064ManifestDigest.slice(7),
  ].join(':');
}

function dependencies(memory, remote) {
  return {
    metadataCache: memory.metadataCache,
    contentCache: memory.contentCache,
    fetcher: remote.fetcher,
    sha256,
  };
}

test('cold MISS and verified HIT use one GHCR acquisition', async () => {
  const f = fixture();
  const memory = caches();
  const remote = upstream(f);
  const deps = dependencies(memory, remote);

  const first = await cacheService.loadDocument(f.lock, deps);
  const second = await cacheService.loadDocument(f.lock, deps);

  assert.equal(first.status, 200);
  assert.equal(first.cache, 'MISS');
  assert.equal(second.status, 200);
  assert.equal(second.cache, 'HIT');
  assert.equal(second.document.provenance.revision, X);
  assert.equal(remote.requests(), 4);
});

test('a GHCR outage preserves only verified stale bytes', async () => {
  const f = fixture();
  const memory = caches();
  const remote = upstream(f);
  const deps = dependencies(memory, remote);

  await cacheService.loadDocument(f.lock, deps);

  memory.advance(16 * 60 * 1000);
  remote.fail();

  const result = await cacheService.loadDocument(f.lock, deps);

  assert.equal(result.status, 200);
  assert.equal(result.state, 'stale');
  assert.equal(result.cache, 'STALE');
  assert.equal(result.document.provenance.revision, X);
});

test('backoff prevents repeated failed GHCR acquisitions', async () => {
  const f = fixture();
  const memory = caches();
  const remote = upstream(f);
  const deps = dependencies(memory, remote);

  await cacheService.loadDocument(f.lock, deps);

  memory.advance(16 * 60 * 1000);
  remote.fail();

  const first = await cacheService.loadDocument(f.lock, deps);
  const requests = remote.requests();
  const second = await cacheService.loadDocument(f.lock, deps);

  assert.equal(first.cache, 'STALE');
  assert.equal(second.cache, 'STALE');
  assert.equal(remote.requests(), requests);
});

test('forged cached D064 bytes cannot become a HIT', async () => {
  const f = fixture();
  const memory = caches();
  const remote = upstream(f);
  const deps = dependencies(memory, remote);

  await cacheService.loadDocument(f.lock, deps);

  const name = cacheName(f.lock);
  const key = `${name}:data`;
  const entry = JSON.parse(memory.contentCache.get(key));

  entry.document = Buffer.from('forged').toString('base64');

  memory.contentCache.set(
    key,
    JSON.stringify(entry),
    24 * 60 * 60 * 1000,
  );

  const result = await cacheService.loadDocument(f.lock, deps);

  assert.equal(result.status, 200);
  assert.equal(result.cache, 'MISS');
  assert.equal(remote.requests(), 8);
});

test('forged cached OCI manifest cannot become a HIT', async () => {
  const f = fixture();
  const memory = caches();
  const remote = upstream(f);
  const deps = dependencies(memory, remote);

  await cacheService.loadDocument(f.lock, deps);

  const name = cacheName(f.lock);
  const key = `${name}:data`;
  const entry = JSON.parse(memory.contentCache.get(key));

  entry.manifest = Buffer.from('{}').toString('base64');

  memory.contentCache.set(
    key,
    JSON.stringify(entry),
    24 * 60 * 60 * 1000,
  );

  const result = await cacheService.loadDocument(f.lock, deps);

  assert.equal(result.status, 200);
  assert.equal(result.cache, 'MISS');
  assert.equal(remote.requests(), 8);
});

test('another X/H/M cannot reuse a cached publication', async () => {
  const f = fixture();
  const memory = caches();
  const remote = upstream(f);
  const deps = dependencies(memory, remote);

  await cacheService.loadDocument(f.lock, deps);

  const other = {
    ...f.lock,
    sourceRevision: 'b'.repeat(40),
    d064ContentSha256: 'c'.repeat(64),
    d064ManifestDigest: `sha256:${'d'.repeat(64)}`,
  };

  const result = await cacheService.loadDocument(other, {
    metadataCache: memory.metadataCache,
    contentCache: memory.contentCache,
    sha256,
  });

  assert.equal(result.status, 503);
  assert.equal(result.document, null);
  assert.equal(remote.requests(), 4);
});

test('an evicted document is fetched despite a fresh marker', async () => {
  const f = fixture();
  const memory = caches();
  const remote = upstream(f);
  const deps = dependencies(memory, remote);

  await cacheService.loadDocument(f.lock, deps);

  memory.contentCache.delete(`${cacheName(f.lock)}:data`);

  const result = await cacheService.loadDocument(f.lock, deps);

  assert.equal(result.status, 200);
  assert.equal(result.cache, 'MISS');
  assert.equal(remote.requests(), 8);
});

test('an active lease prevents concurrent fetching', async () => {
  const f = fixture();
  const memory = caches();
  const remote = upstream(f);

  memory.metadataCache.set(
    `${cacheName(f.lock)}:fetching`,
    '1',
    20000,
  );

  const result = await cacheService.loadDocument(
    f.lock,
    dependencies(memory, remote),
  );

  assert.equal(result.status, 503);
  assert.equal(remote.requests(), 0);
});

test('missing shared cache prevents network access', async () => {
  const f = fixture();
  const remote = upstream(f);

  const result = await cacheService.loadDocument(f.lock, {
    fetcher: remote.fetcher,
    sha256,
  });

  assert.equal(result.status, 503);
  assert.equal(remote.requests(), 0);
});

test('missing SHA-256 verification fails closed', async () => {
  const f = fixture();
  const memory = caches();
  const remote = upstream(f);

  const result = await cacheService.loadDocument(f.lock, {
    metadataCache: memory.metadataCache,
    contentCache: memory.contentCache,
    fetcher: remote.fetcher,
  });

  assert.equal(result.status, 503);
  assert.equal(remote.requests(), 0);
});

test('corrupted cached bytes with no network are unavailable', async () => {
  const f = fixture();
  const memory = caches();
  const remote = upstream(f);
  const deps = dependencies(memory, remote);

  await cacheService.loadDocument(f.lock, deps);

  const key = `${cacheName(f.lock)}:data`;
  memory.contentCache.set(
    key,
    '{"schemaVersion":1,"document":"forged"}',
    24 * 60 * 60 * 1000,
  );

  const result = await cacheService.loadDocument(f.lock, {
    metadataCache: memory.metadataCache,
    contentCache: memory.contentCache,
    sha256,
  });

  assert.equal(result.status, 503);
  assert.equal(result.document, null);
});
