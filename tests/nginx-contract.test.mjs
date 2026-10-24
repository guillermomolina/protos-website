import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dockerfile = readFileSync('Dockerfile', 'utf8');
const config = readFileSync(
  'server/nginx/default.conf.template',
  'utf8',
);
const source = readFileSync(
  'server/github-release.js',
  'utf8',
);

test('uses pinned official NGINX njs-capable image', () => {
  assert.match(
    dockerfile,
    /FROM ghcr\.io\/nginx\/nginx-unprivileged:1\.30\.6-alpine3\.24@sha256:517607ae849a46afbd400616a783e4ead0290f52d20ccc0618ccea1a49362474 AS production/,
  );

  assert.doesNotMatch(
    dockerfile,
    /alpine3\.24-slim@sha256/,
  );

  assert.match(
    dockerfile,
    /load_module modules\/ngx_http_js_module\.so/,
  );

  assert.match(
    dockerfile,
    /COPY --chown=101:0 server\/github-release\.js/,
  );

  assert.doesNotMatch(
    dockerfile.slice(dockerfile.indexOf(' AS production')),
    /\bapk add\b/,
  );
});

test('uses shared cache and verified HTTPS', () => {
  assert.match(
    config,
    /js_shared_dict_zone zone=protos_content:2m timeout=24h;/,
  );

  assert.match(
    config,
    /resolver \$\{NGINX_LOCAL_RESOLVERS\}/,
  );

  assert.match(
    config,
    /js_fetch_trusted_certificate \/etc\/ssl\/certs\/ca-certificates\.crt;/,
  );

  assert.match(config, /js_fetch_verify on;/);
  assert.match(config, /js_content release\.release;/);

  assert.match(
    source,
    /ngx\.shared\.protos_content/,
  );
});

test('preserves static site and exposes only fixed endpoint', () => {
  assert.match(config, /listen 8080;/);
  assert.match(
    config,
    /root \/usr\/share\/nginx\/html;/,
  );
  assert.match(
    config,
    /location = \/api\/live\/release/,
  );
  assert.match(config, /limit_except GET/);
  assert.match(config, /location \/ \{/);
  assert.match(config, /try_files \$uri \$uri\/ =404;/);

  assert.doesNotMatch(config, /proxy_pass/);
  assert.doesNotMatch(config, /autoindex on/);
});

test('uses njs-compatible default module export', () => {
  assert.ok(source.includes('export default {'));
  assert.ok(
    source.includes(
      'normalizeLatestRelease: normalizeLatestRelease',
    ),
  );
  assert.ok(
    source.includes('serveRelease: serveRelease'),
  );
  assert.ok(source.includes('release: release'));

  assert.doesNotMatch(
    source,
    /^export\s+(?:async\s+)?function\b/m,
  );
  assert.doesNotMatch(
    source,
    /\bfor\s*\([^)]*\bof\b/,
  );
  assert.doesNotMatch(source, /\bcatch\s*\{/);
  assert.doesNotMatch(source, /\?\?/);
  assert.doesNotMatch(
    source,
    /async function serveRelease\(request,\s*\{/,
  );
});


test('WEB011-D news endpoint wiring', async () => {
  const { readFileSync } = await import('node:fs');

  const nginx = readFileSync(
    'server/nginx/default.conf.template',
    'utf8',
  );

  const docker = readFileSync('Dockerfile', 'utf8');

  const adapter = readFileSync(
    'server/github-announcements.js',
    'utf8',
  );

  assert.match(
    nginx,
    /js_import news from \/etc\/nginx\/njs\/github-announcements\.js;/,
  );

  assert.match(
    nginx,
    /location = \/api\/live\/news \{/,
  );

  assert.match(nginx, /js_content news\.news;/);
  assert.match(nginx, /js_fetch_verify on;/);

  assert.match(
    nginx,
    /js_fetch_max_response_buffer_size 2m;/,
  );

  assert.match(
    docker,
    /server\/github-announcements-core\.js/,
  );

  assert.match(
    docker,
    /server\/github-announcements-service\.js/,
  );

  assert.match(
    docker,
    /server\/github-announcements\.js/,
  );

  assert.match(adapter, /import xml from 'xml';/);

  assert.match(
    adapter,
    /normalizeAnnouncementsDocument/,
  );

  assert.doesNotMatch(adapter, /\bfor\s*\([^)]*\bof\b/);
});


test('rejects unexpectedly empty non-empty Atom feeds', () => {
  const adapter = readFileSync(
    'server/github-announcements.js',
    'utf8',
  );

  assert.match(
    adapter,
    /sourceEntries\.length > 0 && entries\.length === 0/,
  );

  assert.match(
    adapter,
    /Unexpected empty Atom normalization/,
  );
});
