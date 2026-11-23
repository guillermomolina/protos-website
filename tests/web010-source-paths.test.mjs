import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');

test('WEB010 main source lock excludes obsolete Protos design and branding', () => {
  const lock = JSON.parse(read('protos-source.lock.json'));
  const prepare = read('scripts/prepare-protos.mjs');
  for (const absent of ['docs/design', 'docs/assets/branding']) {
    assert.equal(lock.canonicalPaths.includes(absent), false);
    assert.equal(prepare.includes(absent), false);
  }
  assert.doesNotMatch(prepare, /materializeBranding|brandingMatchesSource/);
});

test('WEB010 website-owned logos are publishable PNG assets', () => {
  const gitignore = read('.gitignore');
  const dockerignore = read('.dockerignore');
  assert.doesNotMatch(gitignore, /^\/public\/protos-branding$/m);
  assert.doesNotMatch(dockerignore, /^public\/protos-branding$/m);

  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  for (const name of ['protos-logo.png', 'protos-symbol.png']) {
    const bytes = readFileSync(`public/protos-branding/${name}`);
    assert.equal(bytes.subarray(0, 8).equals(png), true);
  }
});

test('WEB010 main guides and specs stay live; design remains local', () => {
  const index = read('src/pages/index.astro');
  const catalog = read('server/github-document-catalog-service.js');
  assert.ok(index.includes("href: '/docs/live/?family=guide'"));
  assert.ok(index.includes("href: '/docs/live/?family=spec'"));
  assert.ok(index.includes("href: '/design/'"));
  assert.doesNotMatch(catalog, /childTree\(docs, 'design'\)/);
});
