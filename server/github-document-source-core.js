import revisionCore from './github-document-revision-core.js';

// WEB011-D4A: immutable raw source, authorized by an exact-tree catalog.
// No request-provided URL, branch, repository, or unverified path.

const REPOSITORY = 'guillermomolina/protos';
const RAW = `https://raw.githubusercontent.com/${REPOSITORY}`;
const SHA = /^[0-9a-f]{40}$/;

const MAX_CATALOG_ENTRIES = 512;
const MAX_DOCUMENT_BYTES = 131072;
const MAX_SOURCE_CHARS = 131072;

function selectDocument(snapshot, catalog, family, relativePath) {
  revisionCore.requireSnapshot(snapshot);

  const location = revisionCore.canonicalDocument(
    snapshot,
    family,
    relativePath,
  );

  if (
    !catalog ||
    typeof catalog !== 'object' ||
    Array.isArray(catalog) ||
    catalog.schemaVersion !== 1 ||
    catalog.kind !== 'canonical-document-catalog' ||
    catalog.repository !== REPOSITORY ||
    catalog.revision !== snapshot.revision ||
    catalog.treeSha !== snapshot.treeSha ||
    !Array.isArray(catalog.entries) ||
    catalog.entries.length > MAX_CATALOG_ENTRIES
  ) {
    throw new Error('Documentation catalog identity mismatch');
  }

  let matched = null;

  for (let i = 0; i < catalog.entries.length; i++) {
    const entry = catalog.entries[i];

    if (
      entry &&
      entry.family === family &&
      entry.path === location.path
    ) {
      if (matched !== null) {
        throw new Error('Duplicate catalog document');
      }

      matched = entry;
    }
  }

  if (
    matched === null ||
    matched.type !== 'blob' ||
    typeof matched.blobSha !== 'string' ||
    !SHA.test(matched.blobSha) ||
    !Number.isInteger(matched.size) ||
    matched.size < 0 ||
    matched.size > MAX_DOCUMENT_BYTES
  ) {
    throw new Error('Document is not admitted by the catalog');
  }

  return {
    schemaVersion: 1,
    repository: REPOSITORY,
    revision: snapshot.revision,
    treeSha: snapshot.treeSha,
    family,
    path: location.path,
    blobSha: matched.blobSha,
    contentKind: location.path.endsWith('.md')
      ? 'markdown'
      : 'protos',
    rawUrl: `${RAW}/${snapshot.revision}/${location.path}`,
    sourceUrl: location.sourceUrl,
  };
}

function normalizeSource(document, body) {
  if (
    !document ||
    document.schemaVersion !== 1 ||
    document.repository !== REPOSITORY ||
    typeof document.revision !== 'string' ||
    !SHA.test(document.revision) ||
    typeof document.treeSha !== 'string' ||
    !SHA.test(document.treeSha) ||
    typeof document.blobSha !== 'string' ||
    !SHA.test(document.blobSha) ||
    typeof document.path !== 'string' ||
    document.rawUrl !==
      `${RAW}/${document.revision}/${document.path}` ||
    document.sourceUrl !==
      `https://github.com/${REPOSITORY}/blob/${document.revision}/${document.path}` ||
    !['markdown', 'protos'].includes(document.contentKind)
  ) {
    throw new Error('Invalid source document descriptor');
  }

  if (
    typeof body !== 'string' ||
    body.length > MAX_SOURCE_CHARS ||
    body.indexOf('\u0000') !== -1 ||
    body.indexOf('\ufffd') !== -1
  ) {
    throw new Error('Invalid canonical source text');
  }

  return {
    schemaVersion: 1,
    kind: 'canonical-document',
    repository: REPOSITORY,
    revision: document.revision,
    treeSha: document.treeSha,
    family: document.family,
    path: document.path,
    sourceUrl: document.sourceUrl,
    contentKind: document.contentKind,
    content: body,
  };
}

export default {
  MAX_DOCUMENT_BYTES,
  selectDocument,
  normalizeSource,
};
