import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import adapter from '../server/github-document-catalog.js';

const revision = 'a'.repeat(40);
const rootTree = 'b'.repeat(40);
const sha = (char) => char.repeat(40);

const tree = (id, entries) => ({
  sha: id,
  truncated: false,
  tree: entries,
});

const directory = (path, id) => ({
  path,
  mode: '040000',
  type: 'tree',
  sha: id,
});

const file = (path) => ({
  path,
  mode: '100644',
  type: 'blob',
  sha: sha('c'),
  size: 100,
});

function fixtures() {
  const api =
    'https://api.github.com/repos/guillermomolina/protos/';
  const data = {};

  data[api + 'commits/main'] = {
    sha: revision,
    html_url:
      `https://github.com/guillermomolina/protos/commit/${revision}`,
    commit: {
      tree: { sha: rootTree },
    },
  };

  const url = (id, recursive = false) =>
    api + 'git/trees/' + id +
    (recursive ? '?recursive=1' : '');

  data[url(rootTree)] = tree(rootTree, [
    directory('spec', sha('d')),
    directory('docs', sha('e')),
    directory('protos', sha('f')),
  ]);

  data[url(sha('e'))] = tree(sha('e'), [
    directory('guide', sha('1')),
  ]);

  data[url(sha('f'))] = tree(sha('f'), [
    directory('tutorials', sha('2')),
    directory('examples', sha('3')),
    directory('lib', sha('4')),
  ]);

  data[url(sha('d'), true)] = tree(sha('d'), [
    file('LANGUAGE.md'),
  ]);

  data[url(sha('1'), true)] = tree(sha('1'), [
    file('00-try-protos.md'),
  ]);

  data[url(sha('2'), true)] = tree(sha('2'), [
    file('README.md'),
  ]);

  data[url(sha('3'), true)] = tree(sha('3'), [
    file('hello.protos'),
  ]);

  data[url(sha('4'), true)] = tree(sha('4'), [
    file('core/Array.protos'),
  ]);

  return data;
}

function fakeCache() {
  const values = new Map();

  return {
    values,
    get(key) {
      return values.get(key);
    },
    set(key, value) {
      values.set(key, value);
      return true;
    },
    add(key, value) {
      if (values.has(key)) return false;
      values.set(key, value);
      return true;
    },
    delete(key) {
      values.delete(key);
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

async function withRuntime(runtime, callback) {
  const previous = globalThis.ngx;
  globalThis.ngx = runtime;

  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete globalThis.ngx;
    } else {
      globalThis.ngx = previous;
    }
  }
}

function runtime(cache, calls, responses = fixtures()) {
  return {
    shared: { protos_content: cache },
    async fetch(url, options) {
      calls.push({ url, options });

      const body = responses[url];

      return {
        status: body === undefined ? 404 : 200,
        async text() {
          return JSON.stringify(body);
        },
      };
    },
  };
}

test('adapter exposes only the fixed catalog handler', () => {
  assert.deepEqual(Object.keys(adapter), ['catalog']);

  const source = readFileSync(
    'server/github-document-catalog.js',
    'utf8',
  );

  assert.match(source, /kind:\s*'development'/);
  assert.doesNotMatch(source, /request\.args/);
  assert.doesNotMatch(source, /request\.uri/);
});

test('NGINX registers one protected catalog endpoint', () => {
  const nginx = readFileSync(
    'server/nginx/default.conf.template',
    'utf8',
  );

  assert.equal(
    nginx.split('location = /api/live/docs/catalog {').length - 1,
    1,
  );

  assert.equal(
    nginx.split('js_content docsCatalog.catalog;').length - 1,
    1,
  );

  assert.equal(
    nginx.split(
      'js_import docsCatalog from /etc/nginx/njs/github-document-catalog.js;',
    ).length - 1,
    1,
  );

  const begin = nginx.indexOf(
    'location = /api/live/docs/catalog {',
  );

  const section = nginx.slice(
    begin,
    nginx.indexOf('js_content docsCatalog.catalog;', begin),
  );

  for (const required of [
    'limit_except GET',
    'deny all;',
    'js_fetch_verify on;',
    'js_fetch_protocols TLSv1.2 TLSv1.3;',
    'js_fetch_timeout 5s;',
    'js_fetch_max_response_buffer_size 2m;',
  ]) {
    assert.ok(section.includes(required), required);
  }
});

test('Dockerfile includes all six documentation modules', () => {
  const docker = readFileSync('Dockerfile', 'utf8');

  for (const name of [
    'github-document-source-core.js',
    'github-document-source-service.js',
    'github-document-catalog-core.js',
    'github-document-catalog-service.js',
    'github-document-catalog-cache.js',
    'github-document-catalog.js',
  ]) {
    const copy =
      `COPY --chown=101:0 server/${name} /etc/nginx/njs/${name}`;

    assert.equal(docker.split(copy).length - 1, 1);
  }
});

test('one resolved snapshot serves all catalog families', async () => {
  const calls = [];
  const cache = fakeCache();

  await withRuntime(runtime(cache, calls), async () => {
    const first = request();
    const second = request();

    await adapter.catalog(first);
    await adapter.catalog(second);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    assert.equal(first.headersOut['X-Protos-Cache'], 'MISS');
    assert.equal(second.headersOut['X-Protos-Cache'], 'HIT');

    assert.equal(first.payload.kind, 'documentation-catalog');
    assert.equal(first.payload.state, 'fresh');

    assert.equal(first.payload.snapshot.revision, revision);
    assert.equal(first.payload.catalog.revision, revision);
    assert.equal(first.payload.catalog.treeSha, rootTree);

    assert.deepEqual(
      first.payload.catalog,
      second.payload.catalog,
    );

    assert.deepEqual(
      first.payload.catalog.entries.map((entry) => entry.family).sort(),
      ['examples', 'guide', 'library', 'spec', 'tutorials'],
    );

    assert.equal(
      first.headersOut['Cache-Control'],
      'no-store',
    );
  });

  // One commit resolution + eight Git tree requests.
  assert.equal(calls.length, 9);
});

test('query parameters cannot select another revision', async () => {
  const cache = fakeCache();
  const calls = [];

  await withRuntime(runtime(cache, calls), async () => {
    const first = request();
    await adapter.catalog(first);

    const injected = request();
    injected.args = {
      ref: 'v0.3.398',
      revision: sha('9'),
      url: 'https://example.com/',
    };

    await adapter.catalog(injected);

    assert.equal(injected.status, 200);
    assert.deepEqual(injected.payload, first.payload);
    assert.equal(
      injected.headersOut['X-Protos-Cache'],
      'HIT',
    );
  });

  assert.equal(calls.length, 9);
});

test('POST cannot contact GitHub', async () => {
  const calls = [];

  await withRuntime(
    runtime(fakeCache(), calls),
    async () => {
      const result = request('POST');
      await adapter.catalog(result);

      assert.equal(result.status, 405);
      assert.equal(result.headersOut.Allow, 'GET');
      assert.equal(result.payload.catalog, null);
    },
  );

  assert.equal(calls.length, 0);
});

test('missing shared cache fails closed', async () => {
  let calls = 0;

  await withRuntime({
    shared: {},
    async fetch() {
      calls++;
      throw new Error('Unexpected request');
    },
  }, async () => {
    const result = request();
    await adapter.catalog(result);

    assert.equal(result.status, 503);
    assert.equal(result.payload.state, 'unavailable');
    assert.equal(result.payload.catalog, null);
  });

  assert.equal(calls, 0);
});

test('invalid Git tree cannot create a partial catalog', async () => {
  const responses = fixtures();

  const treeUrl =
    'https://api.github.com/repos/guillermomolina/protos/git/trees/' +
    rootTree;

  responses[treeUrl].sha = sha('9');

  await withRuntime(
    runtime(fakeCache(), [], responses),
    async () => {
      const result = request();
      await adapter.catalog(result);

      assert.equal(result.status, 503);
      assert.equal(result.payload.catalog, null);
    },
  );
});

test('last valid catalog remains available during GitHub failure', async () => {
  const cache = fakeCache();
  const calls = [];
  const responses = fixtures();

  await withRuntime(
    runtime(cache, calls, responses),
    async () => {
      const initial = request();
      await adapter.catalog(initial);

      assert.equal(initial.status, 200);

      cache.delete(
        `docs:catalog:${revision}:fresh`,
      );

      const treeUrl =
        'https://api.github.com/repos/guillermomolina/protos/git/trees/' +
        rootTree;

      delete responses[treeUrl];

      const degraded = request();
      await adapter.catalog(degraded);

      assert.equal(degraded.status, 200);
      assert.equal(degraded.payload.state, 'stale');
      assert.equal(
        degraded.headersOut['X-Protos-Cache'],
        'STALE',
      );

      assert.deepEqual(
        degraded.payload.catalog,
        initial.payload.catalog,
      );
    },
  );
});
