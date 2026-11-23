import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');

test('WEB010 primary curated pages link into live main instead of retired outputs', () => {
  for (const file of [
    'src/content/docs/learn/index.md',
    'src/content/docs/learn/guide/index.md',
    'src/content/docs/learn/tutorials/index.md',
    'src/content/docs/learn/examples/index.md',
    'src/content/docs/reference/index.md',
    'src/content/docs/reference/language/index.md',
    'src/content/docs/reference/standard-library/index.md',
  ]) {
    const s = read(file);
    assert.match(s, /\/docs\/live\/\?family=/, file);
    assert.doesNotMatch(s, /\]\(\/(?:learn\/guide\/\d{2}-|learn\/tutorials\/\d{2}-|reference\/language\/semantics\/)/, file);
    assert.doesNotMatch(s, /generated (?:group|program) page/i, file);
  }
});

test('WEB010 current first-run guide no longer pins obsolete release', () => {
  const s = read('src/content/docs/learn/getting-started/index.md');
  assert.match(s, /docs\/guide\/00-try-protos\.md/);
  assert.doesNotMatch(s, /0\.3\.312|v0\.4\.192/);
});

test('WEB010 D064 is identified as separate, possibly lagging publication', () => {
  const s = read('src/content/docs/reference/standard-library/index.md');
  assert.match(s, /\/api\/live\/docs\/d064/);
  assert.match(s, /may lag `main`/);
  assert.match(s, /publication\.sourceRevision/);
  const ui = read('src/scripts/live-docs-ui.js');
  assert.match(ui, /requestedFilter/);
});
