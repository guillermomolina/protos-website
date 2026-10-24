import d064 from './ghcr-d064-core.js';

// WEB011-D5B2-C1: website-owned, versioned D064 publication registry.
// The mutable GitHub branch discovers locks. X/H/M remain artifact authority.

const INDEX_URL =
  'https://raw.githubusercontent.com/' +
  'guillermomolina/protos-website/main/' +
  'protos-d064-publications.json';

const MAX_INDEX_BYTES = 128 * 1024;
const MAX_PUBLICATIONS = 128;

const INDEX_FIELDS = [
  'schemaVersion',
  'kind',
  'repository',
  'activeRevision',
  'publications',
];

function exactFields(value, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  const keys = Object.keys(value);

  if (keys.length !== fields.length) {
    return false;
  }

  for (let i = 0; i < fields.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(value, fields[i])) {
      return false;
    }
  }

  return true;
}

function admitIndex(input) {
  if (
    !exactFields(input, INDEX_FIELDS) ||
    input.schemaVersion !== 1 ||
    input.kind !== 'protos-d064-publications' ||
    input.repository !== 'guillermomolina/protos' ||
    !Array.isArray(input.publications) ||
    input.publications.length === 0 ||
    input.publications.length > MAX_PUBLICATIONS
  ) {
    throw new Error('Invalid D064 publication registry');
  }

  const locks = [];
  const revisions = Object.create(null);
  const contentDigests = Object.create(null);
  const manifestDigests = Object.create(null);

  let activeFound = false;

  for (let i = 0; i < input.publications.length; i++) {
    const lock = d064.admitLock(input.publications[i]);
    const X = lock.sourceRevision;
    const H = lock.d064ContentSha256;
    const M = lock.d064ManifestDigest;

    if (
      revisions[X] ||
      contentDigests[H] ||
      manifestDigests[M]
    ) {
      throw new Error('Duplicate D064 publication identity');
    }

    revisions[X] = true;
    contentDigests[H] = true;
    manifestDigests[M] = true;

    if (X === input.activeRevision) {
      activeFound = true;
    }

    locks.push(lock);
  }

  if (!activeFound) {
    throw new Error('Active D064 revision is not published');
  }

  return Object.freeze({
    schemaVersion: 1,
    kind: 'protos-d064-publications',
    repository: 'guillermomolina/protos',
    activeRevision: input.activeRevision,
    publications: Object.freeze(locks),
  });
}

function activeLock(index) {
  const admitted = admitIndex(index);

  for (let i = 0; i < admitted.publications.length; i++) {
    const lock = admitted.publications[i];

    if (lock.sourceRevision === admitted.activeRevision) {
      return lock;
    }
  }

  throw new Error('Active D064 publication unavailable');
}

export default {
  INDEX_URL,
  MAX_INDEX_BYTES,
  MAX_PUBLICATIONS,
  admitIndex,
  activeLock,
};
