import test from 'node:test';
import assert from 'node:assert/strict';

import service from '../server/github-document-revision-service.js';

const sha = 'a'.repeat(40);
const another = 'b'.repeat(40);
const treeSha = 'c'.repeat(40);

const development = { kind: 'development' };
const release = { kind: 'release', tag: 'v0.3.398' };

function commit(revision = sha, extra = {}) {
  return {
    sha: revision,
    html_url:
      `https://github.com/guillermomolina/protos/commit/${revision}`,
    commit: { tree: { sha: treeSha } },
    ...extra,
  };
}

function cache() {
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
      if (values.has(key)) return false;
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

function request(method = 'GET') {
  return {
    method,
    headersOut: {},
    status: 0,
    payload: null,
    return(status, raw) {
      this.status = status;
      this.payload = JSON.parse(raw);
    },
  };
}

function fetchJSON(value, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });

    return {
      status: 200,
      async text() {
        return JSON.stringify(value);
      },
    };
  };
}

test('development resolves main to exact SHA; MISS then HIT', async () => {
  const c = cache();
  const calls = [];
  const deps = {
    cache: c,
    fetcher: fetchJSON(commit(), calls),
  };

  const first = request();
  const second = request();

  await service.serveSnapshot(first, development, deps);
  await service.serveSnapshot(second, development, deps);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.headersOut['X-Protos-Cache'], 'MISS');
  assert.equal(second.headersOut['X-Protos-Cache'], 'HIT');

  assert.equal(first.payload.kind, 'documentation-snapshot');
  assert.equal(first.payload.state, 'fresh');
  assert.equal(first.payload.snapshot.revision, sha);
  assert.equal(first.payload.snapshot.ref, 'main');

  assert.equal(
    c.times.get('docs:revision:development:fresh'),
    900000,
  );

  assert.equal(
    c.times.get('docs:revision:development:stale'),
    86400000,
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://api.github.com/repos/guillermomolina/protos/commits/main',
  );
  assert.equal(calls[0].options.method, 'GET');
});

test('release snapshot uses exact tag and isolated cache', async () => {
  const c = cache();

  await service.serveSnapshot(request(), development, {
    cache: c,
    fetcher: fetchJSON(commit()),
  });

  const result = request();
  const calls = [];

  await service.serveSnapshot(result, release, {
    cache: c,
    fetcher: fetchJSON(commit(another), calls),
  });

  assert.equal(result.status, 200);
  assert.equal(result.payload.snapshot.kind, 'release');
  assert.equal(result.payload.snapshot.ref, 'v0.3.398');
  assert.equal(result.payload.snapshot.revision, another);

  assert.equal(
    calls[0].url,
    'https://api.github.com/repos/guillermomolina/protos/commits/v0.3.398',
  );

  assert.ok(c.get('docs:revision:development:fresh'));
  assert.ok(c.get('docs:revision:release:v0.3.398:fresh'));
});

test('invalid selector fails before upstream request', async () => {
  const c = cache();

  await assert.rejects(() =>
    service.serveSnapshot(
      request(),
      { kind: 'release', tag: '../../foreign' },
      {
        cache: c,
        fetcher() {
          throw new Error('Must not fetch');
        },
      },
    ),
  );

  assert.equal(c.values.size, 0);
});

test('upstream failure preserves stale and enables backoff', async () => {
  const c = cache();

  await service.serveSnapshot(request(), development, {
    cache: c,
    fetcher: fetchJSON(commit()),
  });

  c.delete('docs:revision:development:fresh');

  let calls = 0;

  const deps = {
    cache: c,
    fetcher: async () => {
      calls++;
      throw new Error('GitHub offline');
    },
  };

  const first = request();
  const second = request();

  await service.serveSnapshot(first, development, deps);
  await service.serveSnapshot(second, development, deps);

  assert.equal(first.status, 200);
  assert.equal(first.payload.state, 'stale');
  assert.equal(first.headersOut['X-Protos-Cache'], 'STALE');
  assert.equal(second.payload.state, 'stale');
  assert.equal(calls, 1);

  assert.equal(
    c.times.get('docs:revision:development:backoff'),
    60000,
  );
});

test('missing cache fails closed without upstream fetch', async () => {
  const result = request();

  await service.serveSnapshot(result, development, {
    fetcher() {
      throw new Error('Must not fetch');
    },
  });

  assert.equal(result.status, 503);
  assert.equal(result.payload.state, 'unavailable');
  assert.equal(result.payload.snapshot, null);
});

test('invalid commit response is never cached', async () => {
  const c = cache();
  const result = request();

  await service.serveSnapshot(result, development, {
    cache: c,
    fetcher: fetchJSON({ sha: 'main' }),
  });

  assert.equal(result.status, 503);
  assert.equal(c.get('docs:revision:development:fresh'), undefined);
  assert.equal(c.get('docs:revision:development:stale'), undefined);
});

test('GitHub rate limit returns safe 503 with backoff', async () => {
  const c = cache();
  const result = request();

  await service.serveSnapshot(result, development, {
    cache: c,
    fetcher: async () => ({
      status: 403,
      async text() {
        throw new Error('Must not read error body');
      },
    }),
  });

  assert.equal(result.status, 503);
  assert.equal(c.get('docs:revision:development:backoff'), '1');
});

test('fetch lease prevents cold request fan-out', async () => {
  const c = cache();
  const result = request();

  c.set('docs:revision:development:fetching', '1', 20000);

  await service.serveSnapshot(result, development, {
    cache: c,
    fetcher() {
      throw new Error('Must not fetch');
    },
  });

  assert.equal(result.status, 503);
});

test('POST cannot initiate a GitHub request', async () => {
  const result = request('POST');

  await service.serveSnapshot(result, development, {
    cache: cache(),
    fetcher() {
      throw new Error('Must not fetch');
    },
  });

  assert.equal(result.status, 405);
  assert.equal(result.headersOut.Allow, 'GET');
});

test('oversized GitHub commit response is rejected', async () => {
  const c = cache();
  const result = request();

  await service.serveSnapshot(result, development, {
    cache: c,
    fetcher: async () => ({
      status: 200,
      async text() {
        return ' '.repeat(1024 * 1024 + 1);
      },
    }),
  });

  assert.equal(result.status, 503);
  assert.equal(c.get('docs:revision:development:stale'), undefined);
});

test('malformed cached data is not returned to clients', async () => {
  const c = cache();
  const result = request();

  c.set(
    'docs:revision:development:fresh',
    JSON.stringify({ revision: 'bad' }),
    900000,
  );

  await service.serveSnapshot(result, development, {
    cache: c,
    fetcher: fetchJSON(commit()),
  });

  assert.equal(result.status, 200);
  assert.equal(result.headersOut['X-Protos-Cache'], 'MISS');
  assert.equal(result.payload.snapshot.revision, sha);
});

test('stale snapshot from another reference is rejected', async () => {
  const c = cache();
  const result = request();

  const mismatched = {
    schemaVersion: 1,
    repository: 'guillermomolina/protos',
    kind: 'release',
    ref: 'v0.3.398',
    revision: sha,
    treeSha,
    sourceUrl:
      `https://github.com/guillermomolina/protos/tree/${sha}`,
  };

  c.set(
    'docs:revision:development:stale',
    JSON.stringify(mismatched),
    86400000,
  );

  await service.serveSnapshot(result, development, {
    cache: c,
    fetcher: async () => {
      throw new Error('Offline');
    },
  });

  assert.equal(result.status, 503);
});

test('module exposes only the explicit resolver entry point', () => {
  assert.deepEqual(
    Object.keys(service),
    ['serveSnapshot'],
  );
});
