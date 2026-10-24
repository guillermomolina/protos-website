import test from 'node:test';
import assert from 'node:assert/strict';

import sourceCore from '../server/github-document-source-core.js';
import sourceService from '../server/github-document-source-service.js';

const sha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const blobSha = 'c'.repeat(40);

const snapshot = {
  schemaVersion: 1,
  repository: 'guillermomolina/protos',
  kind: 'development',
  ref: 'main',
  revision: sha,
  treeSha,
  sourceUrl:
    `https://github.com/guillermomolina/protos/tree/${sha}`,
};

function entry(
  family = 'guide',
  path = 'docs/guide/00-try-protos.md',
  extra = {},
) {
  return {
    family,
    path,
    type: 'blob',
    blobSha,
    size: 9000,
    ...extra,
  };
}

function catalog(entries = [entry()], extra = {}) {
  return {
    schemaVersion: 1,
    kind: 'canonical-document-catalog',
    repository: 'guillermomolina/protos',
    revision: sha,
    treeSha,
    entries,
    ...extra,
  };
}

function select(
  family = 'guide',
  path = '00-try-protos.md',
  selectedCatalog = catalog(),
) {
  return sourceCore.selectDocument(
    snapshot,
    selectedCatalog,
    family,
    path,
  );
}

test('source URLs are pinned to the snapshot SHA', () => {
  const result = select();

  assert.equal(result.revision, sha);
  assert.equal(result.treeSha, treeSha);
  assert.equal(result.blobSha, blobSha);

  assert.equal(
    result.rawUrl,
    `https://raw.githubusercontent.com/guillermomolina/protos/${sha}/docs/guide/00-try-protos.md`,
  );

  assert.equal(
    result.sourceUrl,
    `https://github.com/guillermomolina/protos/blob/${sha}/docs/guide/00-try-protos.md`,
  );
});

test('all four canonical families can be admitted', () => {
  const cases = [
    ['spec', 'LANGUAGE.md', 'spec/LANGUAGE.md'],
    ['guide', 'README.md', 'docs/guide/README.md'],
    ['tutorials', 'README.md', 'protos/tutorials/README.md'],
    ['examples', 'hello.protos', 'protos/examples/hello.protos'],
  ];

  for (const [family, relative, path] of cases) {
    const result = select(
      family,
      relative,
      catalog([entry(family, path)]),
    );

    assert.equal(result.path, path);
    assert.equal(result.family, family);
  }
});

test('catalog must be from the same exact commit', () => {
  assert.throws(() => select(
    'guide',
    '00-try-protos.md',
    catalog(undefined, { revision: 'd'.repeat(40) }),
  ));
});

test('catalog must be from the same Git tree', () => {
  assert.throws(() => select(
    'guide',
    '00-try-protos.md',
    catalog(undefined, { treeSha: 'd'.repeat(40) }),
  ));
});

test('catalog identity and shape are mandatory', () => {
  assert.throws(() => select(
    'guide',
    '00-try-protos.md',
    catalog(undefined, { repository: 'other/repository' }),
  ));

  assert.throws(() => select(
    'guide',
    '00-try-protos.md',
    catalog([], { entries: 'not-an-array' }),
  ));
});

test('missing documents are never fetched', () => {
  assert.throws(() => select(
    'guide',
    'other.md',
  ));
});

test('duplicate catalog entries fail closed', () => {
  assert.throws(() => select(
    'guide',
    '00-try-protos.md',
    catalog([entry(), entry()]),
  ));
});

test('symlinks, invalid blobs and oversized files are rejected', () => {
  for (const modification of [
    { type: 'symlink' },
    { blobSha: 'invalid' },
    { size: -1 },
    { size: 131073 },
  ]) {
    assert.throws(() => select(
      'guide',
      '00-try-protos.md',
      catalog([entry(
        'guide',
        'docs/guide/00-try-protos.md',
        modification,
      )]),
    ));
  }
});

test('catalog entries have a finite upper bound', () => {
  assert.throws(() => select(
    'guide',
    '00-try-protos.md',
    catalog(Array.from({ length: 513 }, () => entry())),
  ));
});

test('source paths reject traversal and URL injection', () => {
  for (const path of [
    '../other.md',
    'a/../../secret.md',
    'a%2Fsecret.md',
    'x.md?ref=main',
    'https://example.com/a.md',
  ]) {
    assert.throws(() => select(
      'guide',
      path,
    ));
  }
});

test('normalized documents retain exact provenance', () => {
  const source = sourceCore.normalizeSource(
    select(),
    '# Introduction\n\nProtos documentation.\n',
  );

  assert.equal(source.kind, 'canonical-document');
  assert.equal(source.revision, sha);
  assert.equal(source.treeSha, treeSha);
  assert.equal(source.family, 'guide');
  assert.equal(source.contentKind, 'markdown');
  assert.equal(source.content.startsWith('# Introduction'), true);
});

test('Protos examples are never classified as Markdown', () => {
  const selected = select(
    'examples',
    'hello.protos',
    catalog([
      entry('examples', 'protos/examples/hello.protos'),
    ]),
  );

  const source = sourceCore.normalizeSource(
    selected,
    'print("Hello")\n',
  );

  assert.equal(source.contentKind, 'protos');
});

test('raw text rejects NUL, invalid Unicode and oversized bodies', () => {
  for (const body of [
    '\u0000',
    '\ufffd',
    'x'.repeat(131073),
  ]) {
    assert.throws(() =>
      sourceCore.normalizeSource(select(), body),
    );
  }
});

test('fetch uses only the admitted pinned source URL', async () => {
  const calls = [];

  const result = await sourceService.loadDocument(
    {
      snapshot,
      catalog: catalog(),
      family: 'guide',
      relativePath: '00-try-protos.md',
    },
    {
      fetcher: async (url, options) => {
        calls.push({ url, options });

        return {
          status: 200,
          async text() {
            return '# Try Protos\n';
          },
        };
      },
    },
  );

  assert.equal(result.revision, sha);
  assert.equal(result.content, '# Try Protos\n');
  assert.equal(calls.length, 1);

  assert.equal(
    calls[0].url,
    `https://raw.githubusercontent.com/guillermomolina/protos/${sha}/docs/guide/00-try-protos.md`,
  );

  assert.equal(calls[0].options.method, 'GET');
  assert.equal(
    calls[0].options.max_response_body_size,
    262144,
  );
});

test('external markup remains data, never rendered HTML', async () => {
  const result = await sourceService.loadDocument(
    {
      snapshot,
      catalog: catalog(),
      family: 'guide',
      relativePath: '00-try-protos.md',
    },
    {
      fetcher: async () => ({
        status: 200,
        async text() {
          return '<script>alert("untrusted")</script>';
        },
      }),
    },
  );

  assert.equal(
    result.content,
    '<script>alert("untrusted")</script>',
  );

  assert.equal('html' in result, false);
});

test('unsafe selection fails before fetching', async () => {
  let calls = 0;

  await assert.rejects(() =>
    sourceService.loadDocument(
      {
        snapshot,
        catalog: catalog(),
        family: 'guide',
        relativePath: '../secret.md',
      },
      {
        fetcher: async () => {
          calls++;
          throw new Error('Unexpected fetch');
        },
      },
    ),
  );

  assert.equal(calls, 0);
});

test('non-200 upstream responses fail closed', async () => {
  for (const status of [301, 302, 403, 404, 500]) {
    await assert.rejects(() =>
      sourceService.loadDocument(
        {
          snapshot,
          catalog: catalog(),
          family: 'guide',
          relativePath: '00-try-protos.md',
        },
        {
          fetcher: async () => ({
            status,
            async text() {
              throw new Error('Error body must not be read');
            },
          }),
        },
      ),
    );
  }
});

test('transport failures never produce partial documents', async () => {
  await assert.rejects(() =>
    sourceService.loadDocument(
      {
        snapshot,
        catalog: catalog(),
        family: 'guide',
        relativePath: '00-try-protos.md',
      },
      {
        fetcher: async () => {
          throw new Error('Network unavailable');
        },
      },
    ),
  );
});

test('service exposes only explicit loadDocument', () => {
  assert.deepEqual(
    Object.keys(sourceService),
    ['loadDocument'],
  );
});
