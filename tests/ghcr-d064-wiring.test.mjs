import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dockerfile = readFileSync(
  new URL('../Dockerfile', import.meta.url),
  'utf8',
);

const nginx = readFileSync(
  new URL('../server/nginx/default.conf.template', import.meta.url),
  'utf8',
);

test('production image contains every D064 njs module', () => {
  const modules = [
    'ghcr-d064-core.js',
    'ghcr-d064-service.js',
    'ghcr-d064-publications-core.js',
    'ghcr-d064-publications-service.js',
    'ghcr-d064-publications-cache.js',
    'ghcr-d064-content-cache.js',
    'ghcr-d064.js',
  ];

  for (const name of modules) {
    assert.ok(
      dockerfile.includes(
        'COPY --chown=101:0 server/' + name +
        ' /etc/nginx/njs/' + name,
      ),
      'Missing production njs file: ' + name,
    );
  }
});

test('D064 route is GET-only with verified TLS and fixed handler', () => {
  assert.ok(
    nginx.includes(
      'js_import docsD064 from /etc/nginx/njs/ghcr-d064.js;',
    ),
  );

  assert.match(
    nginx,
    /location = \/api\/live\/docs\/d064 \{[\s\S]*?limit_except GET/,
  );

  assert.match(
    nginx,
    /location = \/api\/live\/docs\/d064 \{[\s\S]*?js_fetch_verify on;/,
  );

  assert.match(
    nginx,
    /location = \/api\/live\/docs\/d064 \{[\s\S]*?js_content docsD064\.document;/,
  );

  assert.match(
    nginx,
    /js_shared_dict_zone zone=protos_content:/,
  );

  assert.match(
    nginx,
    /js_shared_dict_zone zone=protos_documents:/,
  );
});
