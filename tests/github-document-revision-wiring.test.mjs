import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import adapter from '../server/github-document-revision.js';

const nginx = readFileSync(
  'server/nginx/default.conf.template',
  'utf8',
);

const docker = readFileSync('Dockerfile', 'utf8');

const endpoint = '/api/live/docs/development';
const upstream =
  'https://api.github.com/repos/guillermomolina/protos/commits/main';

function request(method = 'GET') {
  return {
    method,
    headersOut: {},
    status: null,
    payload: null,
    return(status, body) {
      this.status = status;
      this.payload = JSON.parse(body);
    },
  };
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

function withRuntime(runtime, action) {
  const previous = globalThis.ngx;
  globalThis.ngx = runtime;

  return Promise.resolve()
    .then(action)
    .finally(() => {
      if (previous === undefined) {
        delete globalThis.ngx;
      } else {
        globalThis.ngx = previous;
      }
    });
}

test('adapter exposes only fixed development selector', () => {
  assert.deepEqual(Object.keys(adapter), ['development']);

  const source = readFileSync(
    'server/github-document-revision.js',
    'utf8',
  );

  assert.match(source, /kind:\s*'development'/);
  assert.doesNotMatch(source, /request\.args/);
  assert.doesNotMatch(source, /request\.uri/);
  assert.doesNotMatch(source, /request\.headersIn/);
});

test('registers one NGINX documentation module', () => {
  const declaration =
    'js_import docsRevision from /etc/nginx/njs/github-document-revision.js;';

  assert.equal(
    nginx.split(declaration).length - 1,
    1,
  );
});

test('registers exactly one fixed development endpoint', () => {
  assert.equal(
    nginx.split(`location = ${endpoint} {`).length - 1,
    1,
  );

  assert.match(
    nginx,
    /js_content docsRevision\.development;/,
  );

  assert.doesNotMatch(
    nginx,
    /location\s+~[^{}]*\/api\/live\/docs/,
  );
});

test('development endpoint preserves GET-only HTTPS policy', () => {
  const start = nginx.indexOf(
    `location = ${endpoint} {`,
  );

  assert.ok(start >= 0);

  const section = nginx.slice(
    start,
    nginx.indexOf('js_content docsRevision.development;', start),
  );

  for (const expected of [
    'limit_except GET',
    'deny all;',
    'js_fetch_verify on;',
    'js_fetch_protocols TLSv1.2 TLSv1.3;',
    'js_fetch_timeout 5s;',
    'js_fetch_max_response_buffer_size 2m;',
  ]) {
    assert.ok(
      section.includes(expected),
      `Missing NGINX policy: ${expected}`,
    );
  }
});

test('production image includes the three D3 modules', () => {
  for (const name of [
    'github-document-revision-core.js',
    'github-document-revision-service.js',
    'github-document-revision.js',
  ]) {
    const copy =
      `COPY --chown=101:0 server/${name} /etc/nginx/njs/${name}`;

    assert.equal(
      docker.split(copy).length - 1,
      1,
    );
  }
});

test('adapter resolves main once, then returns a cache HIT', async () => {
  const cache = fakeCache();
  const calls = [];

  const revision = 'a'.repeat(40);
  const treeSha = 'b'.repeat(40);

  await withRuntime({
    shared: { protos_content: cache },
    async fetch(url, options) {
      calls.push({ url, options });

      return {
        status: 200,
        async text() {
          return JSON.stringify({
            sha: revision,
            html_url:
              `https://github.com/guillermomolina/protos/commit/${revision}`,
            commit: {
              tree: { sha: treeSha },
            },
          });
        },
      };
    },
  }, async () => {
    const first = request();
    const second = request();

    await adapter.development(first);
    await adapter.development(second);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    assert.equal(
      first.headersOut['X-Protos-Cache'],
      'MISS',
    );

    assert.equal(
      second.headersOut['X-Protos-Cache'],
      'HIT',
    );

    assert.equal(
      first.payload.snapshot.revision,
      revision,
    );

    assert.equal(
      first.payload.snapshot.ref,
      'main',
    );

    assert.equal(first.payload.state, 'fresh');
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, upstream);
  assert.equal(calls[0].options.method, 'GET');
});

test('POST is rejected without calling GitHub', async () => {
  let calls = 0;

  await withRuntime({
    shared: {
      protos_content: fakeCache(),
    },
    async fetch() {
      calls++;
      throw new Error('Unexpected upstream fetch');
    },
  }, async () => {
    const result = request('POST');

    await adapter.development(result);

    assert.equal(result.status, 405);
    assert.equal(result.headersOut.Allow, 'GET');
  });

  assert.equal(calls, 0);
});

test('missing shared cache fails closed', async () => {
  let calls = 0;

  await withRuntime({
    shared: {},
    async fetch() {
      calls++;
      throw new Error('Unexpected upstream fetch');
    },
  }, async () => {
    const result = request();

    await adapter.development(result);

    assert.equal(result.status, 503);
    assert.equal(result.payload.snapshot, null);
  });

  assert.equal(calls, 0);
});
