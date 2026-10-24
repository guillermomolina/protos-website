import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import core from '../server/ghcr-d064-publications-core.js';
import cacheService from '../server/ghcr-d064-publications-cache.js';

const registry = JSON.parse(
  readFileSync(
    new URL('../protos-d064-publications.json', import.meta.url),
    'utf8',
  ),
);

function memoryCache() {
  let now = 0;
  const values = new Map();

  function get(name) {
    const entry = values.get(name);

    if (!entry) return undefined;

    if (entry.until <= now) {
      values.delete(name);
      return undefined;
    }

    return entry.value;
  }

  function set(name, value, ttl) {
    values.set(name, {
      value,
      until: now + ttl,
    });

    return true;
  }

  function add(name, value, ttl) {
    if (get(name) !== undefined) return false;
    return set(name, value, ttl);
  }

  function remove(name) {
    return values.delete(name);
  }

  function advance(milliseconds) {
    now += milliseconds;
  }

  return { get, set, add, delete: remove, advance };
}

function reply(status, body = '') {
  const bytes = Buffer.from(body);

  return {
    status,
    headers: { get: () => null },
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer;
    },
  };
}

function transport(payload = registry) {
  let count = 0;
  let current = payload;
  let broken = false;

  async function fetcher(url, options) {
    count++;

    assert.equal(url, core.INDEX_URL);
    assert.equal(options.method, 'GET');

    if (broken) {
      throw new Error('GitHub unavailable');
    }

    return reply(200, JSON.stringify(current));
  }

  return {
    fetcher,
    count: () => count,
    replace: (value) => { current = value; },
    fail: () => { broken = true; },
    recover: () => { broken = false; },
  };
}

function newerRegistry() {
  const next = JSON.parse(JSON.stringify(registry));
  const previous = next.publications[0];

  const X = 'b'.repeat(40);

  next.publications.push({
    ...previous,
    sourceRevision: X,
    d064ContentSha256: 'c'.repeat(64),
    d064ManifestDigest: `sha256:${'d'.repeat(64)}`,
  });

  next.activeRevision = X;

  return next;
}

test('cold MISS followed by HIT requires one GitHub request', async () => {
  const cache = memoryCache();
  const upstream = transport();
  const deps = { cache, fetcher: upstream.fetcher };

  const first = await cacheService.loadIndex(deps);
  const second = await cacheService.loadIndex(deps);

  assert.equal(first.status, 200);
  assert.equal(first.state, 'fresh');
  assert.equal(first.cache, 'MISS');

  assert.equal(second.status, 200);
  assert.equal(second.state, 'fresh');
  assert.equal(second.cache, 'HIT');

  assert.equal(upstream.count(), 1);
});

test('a newer GitHub registry refreshes after the fresh TTL', async () => {
  const cache = memoryCache();
  const upstream = transport();
  const deps = { cache, fetcher: upstream.fetcher };

  await cacheService.loadIndex(deps);

  const newer = newerRegistry();
  upstream.replace(newer);
  cache.advance(16 * 60 * 1000);

  const refreshed = await cacheService.loadIndex(deps);

  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.cache, 'MISS');
  assert.equal(refreshed.index.activeRevision, newer.activeRevision);
  assert.equal(refreshed.index.publications.length, 2);
  assert.equal(upstream.count(), 2);
});

test('GitHub outage preserves the last admitted registry', async () => {
  const cache = memoryCache();
  const upstream = transport();
  const deps = { cache, fetcher: upstream.fetcher };

  await cacheService.loadIndex(deps);

  cache.advance(16 * 60 * 1000);
  upstream.fail();

  const recovered = await cacheService.loadIndex(deps);

  assert.equal(recovered.status, 200);
  assert.equal(recovered.state, 'stale');
  assert.equal(recovered.cache, 'STALE');
  assert.equal(
    recovered.index.activeRevision,
    registry.activeRevision,
  );
});

test('backoff prevents repeated requests during an outage', async () => {
  const cache = memoryCache();
  const upstream = transport();
  const deps = { cache, fetcher: upstream.fetcher };

  await cacheService.loadIndex(deps);

  cache.advance(16 * 60 * 1000);
  upstream.fail();

  const first = await cacheService.loadIndex(deps);
  const requests = upstream.count();
  const second = await cacheService.loadIndex(deps);

  assert.equal(first.cache, 'STALE');
  assert.equal(second.cache, 'STALE');
  assert.equal(upstream.count(), requests);
});

test('cold upstream failure is unavailable, not an empty registry', async () => {
  const cache = memoryCache();
  const upstream = transport();
  upstream.fail();

  const first = await cacheService.loadIndex({
    cache,
    fetcher: upstream.fetcher,
  });

  const second = await cacheService.loadIndex({
    cache,
    fetcher: upstream.fetcher,
  });

  assert.equal(first.status, 503);
  assert.equal(first.index, null);
  assert.equal(second.status, 503);
  assert.equal(upstream.count(), 1);
});

test('an active lease prevents concurrent rebuilding', async () => {
  const cache = memoryCache();
  const upstream = transport();

  cache.set('d064:publications:fetching', '1', 60000);

  const result = await cacheService.loadIndex({
    cache,
    fetcher: upstream.fetcher,
  });

  assert.equal(result.status, 503);
  assert.equal(upstream.count(), 0);
});

test('missing shared cache prevents GitHub access', async () => {
  const upstream = transport();

  const result = await cacheService.loadIndex({
    fetcher: upstream.fetcher,
  });

  assert.equal(result.status, 503);
  assert.equal(upstream.count(), 0);
});

test('corrupt fresh cache cannot bypass registry admission', async () => {
  const cache = memoryCache();
  const upstream = transport();

  cache.set(
    'd064:publications:fresh',
    JSON.stringify({
      ...registry,
      activeRevision: 'f'.repeat(40),
    }),
    60000,
  );

  const result = await cacheService.loadIndex({
    cache,
    fetcher: upstream.fetcher,
  });

  assert.equal(result.status, 200);
  assert.equal(result.cache, 'MISS');
  assert.equal(result.index.activeRevision, registry.activeRevision);
  assert.equal(upstream.count(), 1);
});

test('invalid upstream registry never becomes last-known-good', async () => {
  const cache = memoryCache();
  const upstream = transport({
    ...registry,
    activeRevision: 'f'.repeat(40),
  });

  const result = await cacheService.loadIndex({
    cache,
    fetcher: upstream.fetcher,
  });

  assert.equal(result.status, 503);
  assert.equal(
    cache.get('d064:publications:fresh'),
    undefined,
  );
  assert.equal(
    cache.get('d064:publications:stale'),
    undefined,
  );
});

test('backoff expires and a repaired upstream can recover', async () => {
  const cache = memoryCache();
  const upstream = transport();
  upstream.fail();

  const deps = { cache, fetcher: upstream.fetcher };

  const failed = await cacheService.loadIndex(deps);
  assert.equal(failed.status, 503);

  upstream.recover();
  cache.advance(61 * 1000);

  const recovered = await cacheService.loadIndex(deps);

  assert.equal(recovered.status, 200);
  assert.equal(recovered.cache, 'MISS');
  assert.equal(upstream.count(), 2);
});

test('without transport, a verified stale registry remains readable', async () => {
  const cache = memoryCache();
  const upstream = transport();

  await cacheService.loadIndex({
    cache,
    fetcher: upstream.fetcher,
  });

  cache.advance(16 * 60 * 1000);

  const result = await cacheService.loadIndex({ cache });

  assert.equal(result.status, 200);
  assert.equal(result.cache, 'STALE');
  assert.equal(result.index.activeRevision, registry.activeRevision);
});
