import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import adapter from '../server/github-document.js';

const nginx = readFileSync(
  new URL('../server/nginx/default.conf.template', import.meta.url),
  'utf8',
);

const docker = readFileSync(
  new URL('../Dockerfile', import.meta.url),
  'utf8',
);

const adapterSource = readFileSync(
  new URL('../server/github-document.js', import.meta.url),
  'utf8',
);

function request(method = 'GET', args = {}) {
  return {
    method,
    args,
    headersOut: {},
    status: 0,
    payload: null,

    return(status, body) {
      this.status = status;
      this.payload = JSON.parse(body);
    },
  };
}

function count(source, fragment) {
  return source.split(fragment).length - 1;
}

test('adapter exports only the fixed document handler', () => {
  assert.deepEqual(Object.keys(adapter), ['document']);
});

test('POST is rejected before accessing GitHub', async () => {
  const result = request('POST', {
    family: 'spec',
    path: 'LANGUAGE.md',
  });

  await adapter.document(result);

  assert.equal(result.status, 405);
  assert.equal(result.headersOut.Allow, 'GET');
  assert.equal(result.payload.document, null);
});

test('missing selection is rejected', async () => {
  const result = request();

  await adapter.document(result);

  assert.equal(result.status, 400);
  assert.equal(result.payload.state, 'unavailable');
});

test('unapproved revision selectors are rejected', async () => {
  const variants = [
    { family: 'spec', path: 'LANGUAGE.md', ref: 'other' },
    { family: 'spec', path: 'LANGUAGE.md', tag: 'v0.3.398' },
    { family: 'spec', path: 'LANGUAGE.md', sha: 'a'.repeat(40) },
    { family: 'spec', path: 'LANGUAGE.md', url: 'https://evil.test/' },
  ];

  for (const args of variants) {
    const result = request('GET', args);

    await adapter.document(result);

    assert.equal(result.status, 400);
    assert.equal(result.payload.snapshot, null);
  }
});

test('unsafe paths fail before resolution', async () => {
  const paths = [
    '../private.md',
    '/etc/passwd',
    'dir/../file.md',
    'dir//file.md',
    'file?.md',
    '%2e%2e/private.md',
    'x'.repeat(1025),
  ];

  for (const path of paths) {
    const result = request('GET', {
      family: 'spec',
      path,
    });

    await adapter.document(result);

    assert.equal(result.status, 400);
  }
});

test('duplicate or non-string arguments fail closed', async () => {
  const variants = [
    { family: ['spec', 'guide'], path: 'LANGUAGE.md' },
    { family: 'spec', path: ['A.md', 'B.md'] },
    { family: null, path: 'LANGUAGE.md' },
    { family: 'spec', path: null },
    { family: 'unknown', path: 'LANGUAGE.md' },
  ];

  for (const args of variants) {
    const result = request('GET', args);

    await adapter.document(result);

    assert.equal(result.status, 400);
  }
});

test('four canonical families pass argument validation', async () => {
  const previous = globalThis.ngx;

  globalThis.ngx = {
    shared: {},
    fetch() {
      throw new Error('Must not fetch');
    },
  };

  try {
    for (const family of [
      'spec',
      'guide',
      'tutorials',
      'examples',
    ]) {
      const result = request('GET', {
        family,
        path: 'sample.md',
      });

      await adapter.document(result);

      // 503 means selection was syntactically accepted.
      // No shared cache is available in this unit test.
      assert.equal(result.status, 503);
    }
  } finally {
    if (previous === undefined) {
      delete globalThis.ngx;
    } else {
      globalThis.ngx = previous;
    }
  }
});

test('missing document cache never initiates fetch', async () => {
  const previous = globalThis.ngx;
  let calls = 0;

  globalThis.ngx = {
    shared: {
      protos_content: {
        get() {
          return undefined;
        },
        add() {
          return true;
        },
        set() {
          return true;
        },
      },
    },

    fetch() {
      calls++;
      throw new Error('Must not fetch');
    },
  };

  try {
    const result = request('GET', {
      family: 'spec',
      path: 'LANGUAGE.md',
    });

    await adapter.document(result);

    assert.equal(result.status, 503);
    assert.equal(result.payload.document, null);
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) {
      delete globalThis.ngx;
    } else {
      globalThis.ngx = previous;
    }
  }
});

test('responses use JSON and safe caching headers', async () => {
  const result = request();

  await adapter.document(result);

  assert.equal(
    result.headersOut['Content-Type'],
    'application/json; charset=utf-8',
  );

  assert.equal(
    result.headersOut['Cache-Control'],
    'no-store',
  );

  assert.equal(
    result.headersOut['X-Content-Type-Options'],
    'nosniff',
  );

  assert.equal(
    result.payload.kind,
    'documentation-document',
  );
});

test('NGINX imports exactly one document adapter', () => {
  assert.equal(
    count(
      nginx,
      'js_import docsDocument from /etc/nginx/njs/github-document.js;',
    ),
    1,
  );
});

test('document route is GET-only and verifies TLS', () => {
  const marker = 'location = /api/live/docs/document {';
  const following = 'location = /api/live/docs/catalog {';

  assert.equal(count(nginx, marker), 1);

  const start = nginx.indexOf(marker);
  const end = nginx.indexOf(following, start);

  assert.ok(start >= 0);
  assert.ok(end > start);

  const location = nginx.slice(start, end);

  assert.match(
    location,
    /limit_except GET\s*\{\s*deny all;/,
  );

  assert.match(location, /js_fetch_verify on;/);
  assert.match(location, /js_fetch_protocols TLSv1\.2 TLSv1\.3;/);
  assert.match(location, /js_fetch_timeout 5s;/);
  assert.match(location, /js_fetch_max_response_buffer_size 512k;/);
  assert.match(location, /js_content docsDocument\.document;/);
});

test('document memory is separate and bounded', () => {
  assert.equal(
    count(
      nginx,
      'js_shared_dict_zone zone=protos_documents:8m timeout=24h evict;',
    ),
    1,
  );

  assert.equal(
    count(
      nginx,
      'js_shared_dict_zone zone=protos_content:2m timeout=24h;',
    ),
    1,
  );
});

test('production image includes both new modules', () => {
  assert.match(
    docker,
    /COPY --chown=101:0 server\/github-document-content-cache\.js \/etc\/nginx\/njs\/github-document-content-cache\.js/,
  );

  assert.match(
    docker,
    /COPY --chown=101:0 server\/github-document\.js \/etc\/nginx\/njs\/github-document\.js/,
  );
});

test('existing documentation and project endpoints remain', () => {
  assert.ok(
    nginx.includes('location = /api/live/docs/catalog {'),
  );

  assert.ok(
    nginx.includes('location = /api/live/docs/development {'),
  );

  assert.ok(
    nginx.includes('js_content docsCatalog.catalog;'),
  );

  assert.ok(
    nginx.includes('js_content docsRevision.development;'),
  );

  assert.ok(nginx.includes('js_content project.issues;'));
  assert.ok(nginx.includes('js_content project.actions;'));
});

test('adapter retains the fixed development authority', () => {
  assert.ok(
    adapterSource.includes("{ kind: 'development' }"),
  );

  assert.ok(
    adapterSource.includes(
      'revisionService.serveSnapshot(',
    ),
  );

  assert.ok(
    adapterSource.includes(
      'catalogCache.loadCatalog(',
    ),
  );

  assert.ok(
    adapterSource.includes(
      'contentCache.loadDocument(',
    ),
  );
});
