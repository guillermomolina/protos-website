import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('WEB010 public navigation selects live main documentation', () => {
  const homepage = readFileSync('src/pages/index.astro', 'utf8');
  const ui = readFileSync('src/scripts/live-docs-ui.js', 'utf8');

  for (const family of ['guide', 'spec']) {
    assert.ok(homepage.includes(`/docs/live/?family=${family}`));
    assert.ok(ui.includes(`'${family}'`));
  }
  assert.ok(homepage.includes("{ label: 'Design', href: '/design/' },"));
});

test('WEB010 runtime resolves main before selecting immutable documents', () => {
  const revision = readFileSync(
    'server/github-document-revision-core.js', 'utf8',
  );
  const catalog = readFileSync(
    'server/github-document-catalog-service.js', 'utf8',
  );

  assert.match(revision, /return 'main';/);
  assert.match(catalog, /snapshot\.treeSha/);
  assert.doesNotMatch(catalog, /childTree\(docs, 'design'\)/);
});
