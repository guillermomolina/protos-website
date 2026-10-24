import test from 'node:test';
import assert from 'node:assert/strict';

import service from '../server/github-announcements-service.js';

const { serveAnnouncements } = service;

function createCache() {
  const storage = new Map();
  const writes = [];

  return {
    storage,
    writes,
    get(key) {
      return storage.get(key);
    },
    add(key, value, ttl) {
      if (storage.has(key)) return false;
      storage.set(key, value);
      writes.push({ key, ttl });
      return true;
    },
    set(key, value, ttl) {
      storage.set(key, value);
      writes.push({ key, ttl });
    },
    delete(key) {
      return storage.delete(key);
    },
  };
}

function request() {
  return {
    headersOut: {},
    return(status, json) {
      this.status = status;
      this.body = JSON.parse(json);
    },
  };
}

function entries() {
  return [{
    title: 'Protos announcement',
    date: '2026-10-23',
    href: 'https://github.com/guillermomolina/protos/discussions/123',
    summary: 'Release information',
  }];
}

function response(status = 200, raw = '<feed/>') {
  return {
    status,
    text: async () => raw,
  };
}

function dependencies(cache, overrides = {}) {
  return {
    cache,
    fetcher: overrides.fetcher || (async () => response()),
    parseFeed: overrides.parseFeed || (() => entries()),
  };
}

test('fetches only the fixed Announcements Atom URL', async () => {
  const cache = createCache();
  const req = request();
  let calls = 0;

  await serveAnnouncements(req, dependencies(cache, {
    fetcher: async (url, options) => {
      calls += 1;
      assert.equal(
        url,
        'https://github.com/guillermomolina/protos/discussions/categories/announcements.atom',
      );
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Accept, 'application/atom+xml');
      return response();
    },
  }));

  assert.equal(req.status, 200);
  assert.equal(req.body.state, 'fresh');
  assert.equal(req.body.entries.length, 1);
  assert.equal(req.headersOut['X-Protos-Cache'], 'MISS');
  assert.equal(calls, 1);
});

test('serves the second request from shared cache', async () => {
  const cache = createCache();
  let calls = 0;

  const deps = dependencies(cache, {
    fetcher: async () => {
      calls += 1;
      return response();
    },
  });

  const first = request();
  const second = request();

  await serveAnnouncements(first, deps);
  await serveAnnouncements(second, deps);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.headersOut['X-Protos-Cache'], 'MISS');
  assert.equal(second.headersOut['X-Protos-Cache'], 'HIT');
  assert.equal(calls, 1);
});

test('uses a 15-minute fresh TTL and 24-hour stale TTL', async () => {
  const cache = createCache();

  await serveAnnouncements(request(), dependencies(cache));

  const fresh = cache.writes.find(
    item => item.key === 'news:fresh'
  );

  const stale = cache.writes.find(
    item => item.key === 'news:stale'
  );

  assert.equal(fresh.ttl, 15 * 60 * 1000);
  assert.equal(stale.ttl, 24 * 60 * 60 * 1000);
});

test('serves stale news when GitHub fails', async () => {
  const cache = createCache();

  await serveAnnouncements(request(), dependencies(cache));
  cache.storage.delete('news:fresh');

  const req = request();

  await serveAnnouncements(req, dependencies(cache, {
    fetcher: async () => response(503),
  }));

  assert.equal(req.status, 200);
  assert.equal(req.body.state, 'stale');
  assert.equal(req.body.entries.length, 1);
  assert.equal(req.headersOut['X-Protos-Cache'], 'HIT');
});

test('fails closed without shared cache', async () => {
  let fetched = false;
  const req = request();

  await serveAnnouncements(req, {
    cache: null,
    fetcher: async () => {
      fetched = true;
      return response();
    },
    parseFeed: () => entries(),
  });

  assert.equal(req.status, 503);
  assert.equal(req.body.state, 'unavailable');
  assert.equal(fetched, false);
});

test('backs off after an upstream failure', async () => {
  const cache = createCache();
  let calls = 0;

  const deps = dependencies(cache, {
    fetcher: async () => {
      calls += 1;
      return response(429);
    },
  });

  const first = request();
  const second = request();

  await serveAnnouncements(first, deps);
  await serveAnnouncements(second, deps);

  assert.equal(first.status, 503);
  assert.equal(second.status, 503);
  assert.equal(calls, 1);
  assert.equal(cache.storage.get(
    'news:retry-after-failure'
  ), '1');
});

test('prevents concurrent fetch fan-out', async () => {
  const cache = createCache();
  let finishFetch;

  const pending = new Promise(resolve => {
    finishFetch = resolve;
  });

  const deps = dependencies(cache, {
    fetcher: () => pending,
  });

  const first = request();
  const second = request();

  const firstCall = serveAnnouncements(first, deps);
  await serveAnnouncements(second, deps);

  assert.equal(second.status, 503);

  finishFetch(response());
  await firstCall;

  assert.equal(first.status, 200);
});

test('rejects invalid normalized data', async () => {
  const cache = createCache();
  const req = request();

  await serveAnnouncements(req, dependencies(cache, {
    parseFeed: () => ({ invalid: true }),
  }));

  assert.equal(req.status, 503);
  assert.equal(req.body.entries.length, 0);
  assert.equal(cache.storage.has('news:fresh'), false);
});

test('does not parse oversized Atom responses', async () => {
  const cache = createCache();
  const req = request();
  let parsed = false;

  await serveAnnouncements(req, dependencies(cache, {
    fetcher: async () => response(
      200,
      'x'.repeat(2 * 1024 * 1024 + 1)
    ),
    parseFeed: () => {
      parsed = true;
      return entries();
    },
  }));

  assert.equal(req.status, 503);
  assert.equal(parsed, false);
});

test('accepts an empty valid Announcements feed', async () => {
  const cache = createCache();
  const req = request();

  await serveAnnouncements(req, dependencies(cache, {
    parseFeed: () => [],
  }));

  assert.equal(req.status, 200);
  assert.deepEqual(req.body.entries, []);
});

test('preserves independent release and news cache keys', async () => {
  const cache = createCache();

  cache.storage.set('release:fresh', 'release-placeholder');

  await serveAnnouncements(request(), dependencies(cache));

  assert.equal(
    cache.storage.get('release:fresh'),
    'release-placeholder',
  );

  assert.equal(cache.storage.has('news:fresh'), true);
});
