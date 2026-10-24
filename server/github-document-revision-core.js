// WEB011-D1: exact-revision identity for canonical Protos documentation.
// Pure contract: no network requests, rendering, or publication.

const REPOSITORY = 'guillermomolina/protos';
const GITHUB = `https://github.com/${REPOSITORY}`;
const API = `https://api.github.com/repos/${REPOSITORY}`;

const SHA = /^[0-9a-f]{40}$/;
const TAG = /^v[0-9]{1,8}\.[0-9]{1,8}\.[0-9]{1,8}$/;
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;

const FAMILIES = {
  spec: {
    root: 'spec',
    extensions: ['.md'],
  },
  guide: {
    root: 'docs/guide',
    extensions: ['.md'],
  },
  tutorials: {
    root: 'protos/tutorials',
    extensions: ['.md', '.protos'],
  },
  examples: {
    root: 'protos/examples',
    extensions: ['.md', '.protos'],
  },
  library: {
    root: 'protos/lib',
    extensions: ['.md', '.protos'],
  },
};

function selectorRef(selector) {
  if (
    !selector ||
    typeof selector !== 'object' ||
    Array.isArray(selector)
  ) {
    throw new Error('Invalid documentation selector');
  }

  if (selector.kind === 'development') {
    if (selector.tag !== undefined) {
      throw new Error('Development must resolve main');
    }

    return 'main';
  }

  if (
    selector.kind === 'release' &&
    typeof selector.tag === 'string' &&
    TAG.test(selector.tag)
  ) {
    return selector.tag;
  }

  throw new Error('Unsupported documentation selector');
}

function commitEndpoint(selector) {
  const ref = selectorRef(selector);

  return `${API}/commits/${ref}`;
}

function normalizeCommit(selector, payload) {
  const ref = selectorRef(selector);

  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw new Error('Invalid GitHub commit response');
  }

  const revision = payload.sha;
  const treeSha = payload.commit?.tree?.sha;

  if (
    typeof revision !== 'string' ||
    !SHA.test(revision) ||
    typeof treeSha !== 'string' ||
    !SHA.test(treeSha) ||
    payload.html_url !== `${GITHUB}/commit/${revision}`
  ) {
    throw new Error('GitHub commit identity mismatch');
  }

  return {
    schemaVersion: 1,
    repository: REPOSITORY,
    kind: selector.kind,
    ref,
    revision,
    treeSha,
    sourceUrl: `${GITHUB}/tree/${revision}`,
  };
}

function requireSnapshot(snapshot) {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot) ||
    snapshot.schemaVersion !== 1 ||
    snapshot.repository !== REPOSITORY ||
    (snapshot.kind !== 'development' &&
      snapshot.kind !== 'release') ||
    typeof snapshot.revision !== 'string' ||
    !SHA.test(snapshot.revision) ||
    typeof snapshot.treeSha !== 'string' ||
    !SHA.test(snapshot.treeSha) ||
    snapshot.sourceUrl !==
      `${GITHUB}/tree/${snapshot.revision}`
  ) {
    throw new Error('Invalid documentation snapshot');
  }

  const selector = snapshot.kind === 'development'
    ? { kind: 'development' }
    : { kind: 'release', tag: snapshot.ref };

  if (selectorRef(selector) !== snapshot.ref) {
    throw new Error('Invalid snapshot reference');
  }

  return snapshot;
}

function canonicalDocument(snapshot, family, relativePath) {
  requireSnapshot(snapshot);

  const configuration = FAMILIES[family];

  if (!configuration) {
    throw new Error('Unsupported documentation family');
  }

  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.length > 240 ||
    relativePath.startsWith('/') ||
    relativePath.endsWith('/')
  ) {
    throw new Error('Invalid document path');
  }

  const segments = relativePath.split('/');

  if (
    segments.length > 12 ||
    segments.length === 0
  ) {
    throw new Error('Invalid document path depth');
  }

  for (let index = 0; index < segments.length; index++) {
    if (
      !SEGMENT.test(segments[index]) ||
      segments[index] === '.' ||
      segments[index] === '..'
    ) {
      throw new Error('Unsafe document path segment');
    }
  }

  const filename = segments[segments.length - 1];
  let allowedExtension = false;

  for (
    let index = 0;
    index < configuration.extensions.length;
    index++
  ) {
    if (filename.endsWith(configuration.extensions[index])) {
      allowedExtension = true;
    }
  }

  if (!allowedExtension) {
    throw new Error('Unsupported document source extension');
  }

  const path = `${configuration.root}/${relativePath}`;
  const revision = snapshot.revision;

  return {
    schemaVersion: 1,
    repository: REPOSITORY,
    revision,
    family,
    path,
    upstream: `${API}/contents/${path}?ref=${revision}`,
    sourceUrl: `${GITHUB}/blob/${revision}/${path}`,
  };
}

// This checks D064's declared provenance, not its cryptographic integrity.
// The independent OCI consumer must still verify manifest M and content H.
function d064ProvenanceMatches(snapshot, document) {
  requireSnapshot(snapshot);

  return Boolean(
    document &&
    typeof document === 'object' &&
    document.format?.name === 'protos-documentation' &&
    document.format?.major === 1 &&
    document.provenance?.kind === 'repositoryRevision' &&
    document.provenance?.repository === REPOSITORY &&
    document.provenance?.revision === snapshot.revision
  );
}

export default {
  REPOSITORY,
  commitEndpoint,
  normalizeCommit,
  requireSnapshot,
  canonicalDocument,
  d064ProvenanceMatches,
};
