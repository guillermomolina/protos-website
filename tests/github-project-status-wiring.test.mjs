import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nginx = readFileSync(
  'server/nginx/default.conf.template',
  'utf8',
);

const docker = readFileSync('Dockerfile', 'utf8');

function route(path) {
  const escaped = path.replaceAll('/', '\\/');
  const pattern = new RegExp(
    `location = ${escaped} \\{([\\s\\S]*?)\\n    \\}`,
  );

  const match = nginx.match(pattern);
  assert.ok(match, `Missing route: ${path}`);

  return match[1];
}

test('project njs module is registered exactly once', () => {
  const declaration =
    'js_import project from /etc/nginx/njs/github-project-status.js;';

  assert.equal(nginx.split(declaration).length - 1, 1);
});

test('Issues route retains fixed TLS and GET-only policy', () => {
  const config = route('/api/live/issues');

  assert.match(config, /limit_except GET/);
  assert.match(config, /deny all/);
  assert.match(config, /js_fetch_verify on/);
  assert.match(config, /js_fetch_protocols TLSv1\.2 TLSv1\.3/);
  assert.match(config, /js_fetch_timeout 5s/);
  assert.match(config, /js_fetch_max_response_buffer_size 1m/);
  assert.match(config, /js_content project\.issues;/);
});

test('Actions route retains fixed TLS and GET-only policy', () => {
  const config = route('/api/live/actions');

  assert.match(config, /limit_except GET/);
  assert.match(config, /deny all/);
  assert.match(config, /js_fetch_verify on/);
  assert.match(config, /js_fetch_protocols TLSv1\.2 TLSv1\.3/);
  assert.match(config, /js_fetch_timeout 5s/);
  assert.match(config, /js_fetch_max_response_buffer_size 1m/);
  assert.match(config, /js_content project\.actions;/);
});

test('both project routes use the existing shared cache', () => {
  assert.match(
    nginx,
    /js_shared_dict_zone zone=protos_content:2m timeout=24h;/,
  );
});

test('production image contains all project njs modules', () => {
  for (const file of [
    'github-project-status-core.js',
    'github-project-status-service.js',
    'github-project-status.js',
  ]) {
    const instruction =
      `COPY --chown=101:0 server/${file} /etc/nginx/njs/${file}`;

    assert.equal(
      docker.split(instruction).length - 1,
      1,
      `Missing COPY: ${file}`,
    );
  }
});

test('existing release and news handlers remain wired', () => {
  assert.match(nginx, /js_content release\.release;/);
  assert.match(nginx, /js_content news\.news;/);
  assert.match(nginx, /location = \/api\/live\/release/);
  assert.match(nginx, /location = \/api\/live\/news/);
});

test('project modules use the built-in njs compatible module surface', () => {
  const files = [
    'server/github-project-status-core.js',
    'server/github-project-status-service.js',
    'server/github-project-status.js',
  ];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');

    assert.match(source, /export default \{/);
    assert.doesNotMatch(source, /\bimport\s*\{/);
    assert.doesNotMatch(source, /\bexport\s+(?:const|function|async\s+function)\b/);
    assert.doesNotMatch(source, /\bnew\s+Set\s*\(/);
    assert.doesNotMatch(
      source,
      /\bfor\s*\(\s*(?:const|let|var)\s+\w+\s+of\s+/,
    );
  }
});

test('njs catch clauses require an explicit binding', () => {
  for (const file of [
    'server/github-project-status-core.js',
    'server/github-project-status-service.js',
    'server/github-project-status.js',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\\bcatch\\s*\\{/);
  }
});
