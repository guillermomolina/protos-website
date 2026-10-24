import test from 'node:test';
import assert from 'node:assert/strict';

import revisionCore from '../server/github-document-revision-core.js';

const sha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const otherSha = 'c'.repeat(40);

const development = { kind: 'development' };
const release = { kind: 'release', tag: 'v0.3.398' };

function commit(revision = sha) {
  return {
    sha: revision,
    html_url:
      `https://github.com/guillermomolina/protos/commit/${revision}`,
    commit: {
      tree: { sha: treeSha },
    },
  };
}

const snapshot = revisionCore.normalizeCommit(
  development,
  commit(),
);

test('development resolves only the fixed main ref', () => {
  assert.equal(
    revisionCore.commitEndpoint(development),
    'https://api.github.com/repos/guillermomolina/protos/commits/main',
  );

  assert.throws(() =>
    revisionCore.commitEndpoint({
      kind: 'development',
      tag: 'another-branch',
    }),
  );
});

test('release tags resolve through the fixed repository', () => {
  assert.equal(
    revisionCore.commitEndpoint(release),
    'https://api.github.com/repos/guillermomolina/protos/commits/v0.3.398',
  );

  assert.throws(() =>
    revisionCore.commitEndpoint({
      kind: 'release',
      tag: '../../foreign',
    }),
  );
});

test('commit response becomes one immutable snapshot', () => {
  assert.deepEqual(snapshot, {
    schemaVersion: 1,
    repository: 'guillermomolina/protos',
    kind: 'development',
    ref: 'main',
    revision: sha,
    treeSha,
    sourceUrl:
      `https://github.com/guillermomolina/protos/tree/${sha}`,
  });
});

test('released version records its tag and exact commit', () => {
  const value = revisionCore.normalizeCommit(
    release,
    commit(),
  );

  assert.equal(value.kind, 'release');
  assert.equal(value.ref, 'v0.3.398');
  assert.equal(value.revision, sha);
});

test('commit identity rejects ambiguous and foreign responses', () => {
  assert.throws(() =>
    revisionCore.normalizeCommit(
      development,
      { ...commit(), sha: 'main' },
    ),
  );

  assert.throws(() =>
    revisionCore.normalizeCommit(
      development,
      {
        ...commit(),
        html_url: 'https://example.com/commit',
      },
    ),
  );

  assert.throws(() =>
    revisionCore.normalizeCommit(
      development,
      { ...commit(), commit: { tree: { sha: 'bad' } } },
    ),
  );
});

test('every document URL uses the snapshot SHA', () => {
  const families = [
    ['spec', 'GRAMMAR.md', 'spec/GRAMMAR.md'],
    ['guide', 'SOURCE_STYLE.md', 'docs/guide/SOURCE_STYLE.md'],
    ['tutorials', 'intro.protos', 'protos/tutorials/intro.protos'],
    ['examples', 'demo.protos', 'protos/examples/demo.protos'],
  ];

  for (const [family, file, expectedPath] of families) {
    const location = revisionCore.canonicalDocument(
      snapshot,
      family,
      file,
    );

    assert.equal(location.revision, sha);
    assert.equal(location.path, expectedPath);

    assert.equal(
      location.upstream,
      `https://api.github.com/repos/guillermomolina/protos/contents/${expectedPath}?ref=${sha}`,
    );

    assert.equal(
      location.sourceUrl,
      `https://github.com/guillermomolina/protos/blob/${sha}/${expectedPath}`,
    );
  }
});

test('nested documents preserve exact revision identity', () => {
  const location = revisionCore.canonicalDocument(
    snapshot,
    'spec',
    'language/expressions.md',
  );

  assert.equal(
    location.path,
    'spec/language/expressions.md',
  );

  assert.equal(location.revision, sha);
});

test('document paths reject traversal and injection', () => {
  for (const path of [
    '../secrets.md',
    'a/../secrets.md',
    '/absolute.md',
    'a//b.md',
    'a\\b.md',
    'a.md?ref=main',
    'a%2Fb.md',
    '.hidden.md',
    'a.md/',
  ]) {
    assert.throws(() =>
      revisionCore.canonicalDocument(
        snapshot,
        'spec',
        path,
      ),
      `Should reject ${path}`,
    );
  }
});

test('unapproved content families and extensions fail closed', () => {
  assert.throws(() =>
    revisionCore.canonicalDocument(
      snapshot,
      'src',
      'Main.java',
    ),
  );

  assert.throws(() =>
    revisionCore.canonicalDocument(
      snapshot,
      'spec',
      'LANGUAGE.txt',
    ),
  );
});

test('a forged or inconsistent snapshot is rejected', () => {
  assert.throws(() =>
    revisionCore.canonicalDocument(
      { ...snapshot, revision: 'main' },
      'spec',
      'GRAMMAR.md',
    ),
  );

  assert.throws(() =>
    revisionCore.canonicalDocument(
      { ...snapshot, repository: 'other/repo' },
      'spec',
      'GRAMMAR.md',
    ),
  );

  assert.throws(() =>
    revisionCore.canonicalDocument(
      { ...snapshot, sourceUrl: 'https://example.com/' },
      'spec',
      'GRAMMAR.md',
    ),
  );
});

test('D064 provenance matches the exact source revision', () => {
  const artifact = {
    format: {
      name: 'protos-documentation',
      major: 1,
      minor: 0,
    },
    provenance: {
      kind: 'repositoryRevision',
      repository: 'guillermomolina/protos',
      revision: sha,
    },
  };

  assert.equal(
    revisionCore.d064ProvenanceMatches(snapshot, artifact),
    true,
  );

  assert.equal(
    revisionCore.d064ProvenanceMatches(snapshot, {
      ...artifact,
      provenance: {
        ...artifact.provenance,
        revision: otherSha,
      },
    }),
    false,
  );
});

test('D064 provenance alone is not a digest verification', () => {
  const artifact = {
    format: { name: 'protos-documentation', major: 1 },
    provenance: {
      kind: 'repositoryRevision',
      repository: 'guillermomolina/protos',
      revision: sha,
    },
  };

  assert.equal(
    revisionCore.d064ProvenanceMatches(snapshot, artifact),
    true,
  );

  // This intentionally does not establish H or M.
  assert.equal('manifestDigest' in snapshot, false);
  assert.equal('contentSha256' in snapshot, false);
});
