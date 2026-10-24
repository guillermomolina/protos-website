import test from 'node:test';
import assert from 'node:assert/strict';

import githubRelease from '../server/github-release.js';

const { normalizeLatestRelease, serveRelease } = githubRelease;

function fixture(
  version = '0.3.398',
  publishedAt = '2026-10-22T13:58:16Z',
) {
  const tag = `v${version}`;
  const prefix =
    `https://github.com/guillermomolina/protos/releases/download/${tag}/`;

  const native = `protos-${version}-native-linux-x86_64.zip`;
  const portable = `protos-${version}-posix-jvm.zip`;

  const asset = (name) => ({
    name,
    state: 'uploaded',
    browser_download_url: `${prefix}${name}`,
    digest: `sha256:${'a'.repeat(64)}`,
  });

  return {
    tag_name: tag,
    html_url:
      `https://github.com/guillermomolina/protos/releases/tag/${tag}`,
    draft: false,
    prerelease: true,
    published_at: publishedAt,
    assets: [
      asset(native),
      asset(`${native}.sha256`),
      asset(portable),
      asset(`${portable}.sha256`),
      asset('RELEASE_MANIFEST.txt'),
    ],
  };
}

function request() {
  return {
    headersOut: {},
    return(status, body) {
      this.status = status;
      this.body = JSON.parse(body);
    },
  };
}

function cache() {
  const entries = new Map();
  const writes = [];

  return {
    entries,
    writes,
    get(key) {
      return entries.get(key);
    },
    add(key, value, ttl) {
      if (entries.has(key)) return false;
      entries.set(key, value);
      writes.push({ key, ttl });
      return true;
    },
    set(key, value, ttl) {
      entries.set(key, value);
      writes.push({ key, ttl });
      return this;
    },
    delete(key) {
      return entries.delete(key);
    },
  };
}

function fetcherFor(releases) {
  return async () => ({
    status: 200,
    text: async () => JSON.stringify(releases),
  });
}

test('selects latest published prerelease, ignoring drafts', () => {
  const oldRelease = fixture('0.3.312', '2026-10-09T10:00:00Z');
  const latest = fixture();
  const draft = fixture('0.3.999', '2026-10-23T10:00:00Z');
  draft.draft = true;

  const result = normalizeLatestRelease([
    oldRelease,
    draft,
    latest,
  ]);

  assert.equal(result.tag, 'v0.3.398');
  assert.equal(result.native.name,
    'protos-0.3.398-native-linux-x86_64.zip');
  assert.equal(result.portable.name,
    'protos-0.3.398-posix-jvm.zip');
});

test('rejects releases without the required assets', () => {
  const latest = fixture();
  latest.assets.pop();

  assert.throws(
    () => normalizeLatestRelease([latest]),
    /Missing or duplicate release asset/,
  );
});

test('rejects asset URL substitution', () => {
  const latest = fixture();
  latest.assets[0].browser_download_url =
    'https://example.invalid/untrusted.zip';

  assert.throws(
    () => normalizeLatestRelease([latest]),
    /Invalid release asset/,
  );
});

test('rejects absent or invalid published prereleases', () => {
  assert.throws(
    () => normalizeLatestRelease([]),
    /No published prerelease/,
  );

  const invalid = fixture();
  invalid.tag_name = 'main';

  assert.throws(
    () => normalizeLatestRelease([invalid]),
    /Invalid release identity/,
  );
});

test('fetches once and then serves shared fresh cache', async () => {
  const storage = cache();
  let calls = 0;

  const fetcher = async (...args) => {
    calls += 1;
    assert.match(args[0], /^https:\/\/api\.github\.com\//);
    return fetcherFor([fixture()])();
  };

  const first = request();
  await serveRelease(first, { cache: storage, fetcher });

  const second = request();
  await serveRelease(second, { cache: storage, fetcher });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.release.tag, 'v0.3.398');
  assert.equal(second.body.state, 'fresh');
  assert.equal(first.headersOut['X-Protos-Cache'], 'MISS');
  assert.equal(second.headersOut['X-Protos-Cache'], 'HIT');
  assert.equal(calls, 1);
  assert.ok(storage.writes.some(
    (item) => item.key === 'release:fresh' &&
      item.ttl === 900000,
  ));
  assert.ok(storage.writes.some(
    (item) => item.key === 'release:stale' &&
      item.ttl === 86400000,
  ));
});

test('serves last known good release on upstream failure', async () => {
  const storage = cache();

  await serveRelease(request(), {
    cache: storage,
    fetcher: fetcherFor([fixture()]),
  });

  storage.delete('release:fresh');

  const response = request();

  await serveRelease(response, {
    cache: storage,
    fetcher: async () => {
      throw new Error('network unavailable');
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.state, 'stale');
  assert.equal(response.body.release.tag, 'v0.3.398');
  assert.equal(storage.get('release:fetching'), undefined);
});

test('fails closed without cached data', async () => {
  const response = request();

  await serveRelease(response, {
    cache: cache(),
    fetcher: async () => ({ status: 429 }),
  });

  assert.equal(response.status, 503);
  assert.equal(response.body.state, 'unavailable');
  assert.equal(response.body.release, null);
});

test('never fetches without shared-cache configuration', async () => {
  let called = false;
  const response = request();

  await serveRelease(response, {
    cache: null,
    fetcher: async () => {
      called = true;
    },
  });

  assert.equal(response.status, 503);
  assert.equal(called, false);
});

test('prevents concurrent upstream fan-out', async () => {
  const storage = cache();
  storage.add('release:fetching', '1', 10000);

  let called = false;
  const response = request();

  await serveRelease(response, {
    cache: storage,
    fetcher: async () => {
      called = true;
    },
  });

  assert.equal(response.status, 503);
  assert.equal(called, false);
});


test('backs off after GitHub returns HTTP 429', async () => {
  const storage = cache();
  let calls = 0;

  const upstream = async () => {
    calls += 1;
    return { status: 429 };
  };

  const first = request();

  await serveRelease(first, {
    cache: storage,
    fetcher: upstream,
  });

  const second = request();

  await serveRelease(second, {
    cache: storage,
    fetcher: upstream,
  });

  assert.equal(first.status, 503);
  assert.equal(second.status, 503);
  assert.equal(calls, 1);

  assert.equal(
    storage.get('release:retry-after-failure'),
    '1',
  );

  assert.ok(storage.writes.some(
    (entry) =>
      entry.key === 'release:retry-after-failure' &&
      entry.ttl === 300000,
  ));
});

test('keeps serving stale data during upstream backoff', async () => {
  const storage = cache();

  await serveRelease(request(), {
    cache: storage,
    fetcher: fetcherFor([fixture()]),
  });

  storage.delete('release:fresh');

  let calls = 0;

  const upstream = async () => {
    calls += 1;
    throw new Error('GitHub unavailable');
  };

  const first = request();

  await serveRelease(first, {
    cache: storage,
    fetcher: upstream,
  });

  const second = request();

  await serveRelease(second, {
    cache: storage,
    fetcher: upstream,
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.state, 'stale');
  assert.equal(second.body.state, 'stale');
  assert.equal(second.body.release.tag, 'v0.3.398');
  assert.equal(calls, 1);
});

test('recovers after upstream backoff expires', async () => {
  const storage = cache();

  await serveRelease(request(), {
    cache: storage,
    fetcher: async () => ({ status: 503 }),
  });

  assert.equal(
    storage.get('release:retry-after-failure'),
    '1',
  );

  // Simulate expiry; the test cache does not advance real time.
  storage.delete('release:retry-after-failure');

  const recovered = request();

  await serveRelease(recovered, {
    cache: storage,
    fetcher: fetcherFor([fixture()]),
  });

  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.state, 'fresh');
  assert.equal(recovered.body.release.tag, 'v0.3.398');

  assert.equal(
    storage.get('release:retry-after-failure'),
    undefined,
  );
});
