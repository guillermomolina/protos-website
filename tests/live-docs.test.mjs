import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOTS, admitCatalog, admitDocument, relativePath, sourceHref
} from '../src/scripts/live-docs-contract.js';

const sha = 'a'.repeat(40);
const tree = 'b'.repeat(40);

function item(family = 'spec') {
  return {
    family, type: 'blob',
    path: `${ROOTS[family].join('/')}/AGENTS.md`,
    blobSha: 'c'.repeat(40), size: 50
  };
}

function catalog(entries = [item()]) {
  return {
    schemaVersion: 1, kind: 'documentation-catalog',
    state: 'fresh',
    snapshot: { revision: sha, treeSha: tree },
    catalog: {
      schemaVersion: 1, kind: 'canonical-document-catalog',
      repository: 'guillermomolina/protos',
      revision: sha, treeSha: tree, entries
    }
  };
}

function document(c, e, text = '<img src=x onerror=alert(1)>') {
  return {
    schemaVersion: 1, kind: 'documentation-document',
    state: 'fresh',
    snapshot: { revision: c.revision, treeSha: c.treeSha },
    document: {
      schemaVersion: 1, kind: 'canonical-document',
      repository: 'guillermomolina/protos',
      revision: c.revision, treeSha: c.treeSha,
      family: e.family, path: e.path,
      contentKind: 'markdown', content: text
    }
  };
}

test('all five families map to admitted relative paths', () => {
  assert.equal(Object.keys(ROOTS).length, 5);
  for (const family of Object.keys(ROOTS)) {
    assert.equal(relativePath(family, item(family).path), 'AGENTS.md');
  }
});

test('library source requires an admitted exact-revision path', () => {
  const library = {
    ...item('library'),
    path: 'protos/lib/core/Array.protos',
  };

  const admitted = admitCatalog(catalog([library]));

  assert.ok(admitted);
  assert.equal(admitted.entries.length, 1);
  assert.equal(admitted.entries[0].family, 'library');
  assert.equal(admitted.entries[0].relative, 'core/Array.protos');

  assert.equal(
    sourceHref(admitted, admitted.entries[0]),
    `https://github.com/guillermomolina/protos/blob/${sha}/protos/lib/core/Array.protos`,
  );

  assert.equal(
    relativePath('library', 'protos/lib/../private.protos'),
    null,
  );

  assert.equal(
    relativePath('library', 'protos/examples/hello.protos'),
    null,
  );

  const unlisted = {
    ...library,
    path: 'protos/lib/core/Other.protos',
  };

  const payload = document(admitted, admitted.entries[0]);
  payload.document.path = unlisted.path;

  assert.equal(
    admitDocument(payload, admitted, admitted.entries[0]),
    null,
  );
});

test('valid catalog preserves exact revision and tree', () => {
  const c = admitCatalog(catalog());
  assert.equal(c.revision, sha);
  assert.equal(c.treeSha, tree);
});

test('wrong commit is rejected', () => {
  const data = catalog();
  data.catalog.revision = 'd'.repeat(40);
  assert.equal(admitCatalog(data), null);
});

test('wrong tree is rejected', () => {
  const data = catalog();
  data.catalog.treeSha = 'd'.repeat(40);
  assert.equal(admitCatalog(data), null);
});

test('duplicate documents are rejected', () => {
  assert.equal(admitCatalog(catalog([item(), item()])), null);
});

test('traversal is rejected', () => {
  const bad = item();
  bad.path = 'spec/../private.md';
  assert.equal(admitCatalog(catalog([bad])), null);
});

test('oversized documents are rejected', () => {
  const bad = item();
  bad.size = 131073;
  assert.equal(admitCatalog(catalog([bad])), null);
});

test('document with wrong revision is rejected', () => {
  const c = admitCatalog(catalog());
  const d = document(c, c.entries[0]);
  d.document.revision = 'd'.repeat(40);
  assert.equal(admitDocument(d, c, c.entries[0]), null);
});

test('document with wrong path is rejected', () => {
  const c = admitCatalog(catalog());
  const d = document(c, c.entries[0]);
  d.document.path = 'spec/OTHER.md';
  assert.equal(admitDocument(d, c, c.entries[0]), null);
});

test('external markup is retained only as source data', () => {
  const c = admitCatalog(catalog());
  const markup = '<script>alert(1)</script>';
  assert.equal(
    admitDocument(document(c, c.entries[0], markup), c, c.entries[0]).text,
    markup
  );
});

test('source URL uses exact commit', () => {
  const c = admitCatalog(catalog());
  assert.equal(
    sourceHref(c, c.entries[0]),
    `https://github.com/guillermomolina/protos/blob/${sha}/spec/AGENTS.md`
  );
});
