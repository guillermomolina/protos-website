import revisionCore from './github-document-revision-core.js';
import sourceCore from './github-document-source-core.js';
import catalogService from './github-document-catalog-service.js';

// WEB011-D4C: bounded, exact-revision catalogue cache.
// Inputs are trusted server-selected snapshots, never HTTP query parameters.

const FRESH_MS = 15 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const BACKOFF_MS = 60 * 1000;
const LEASE_MS = 60 * 1000;

const MAX_CACHE_CHARS = 200000;
const MAX_ENTRIES = 512;

const PREFIXES = {
  spec: 'spec/',
  guide: 'docs/guide/',
  tutorials: 'protos/tutorials/',
  examples: 'protos/examples/',
  library: 'protos/lib/',
};

function key(snapshot, part) {
  revisionCore.requireSnapshot(snapshot);
  return `docs:catalog:${snapshot.revision}:${part}`;
}

function validateCatalog(snapshot, catalog) {
  revisionCore.requireSnapshot(snapshot);

  if (
    !catalog ||
    typeof catalog !== 'object' ||
    Array.isArray(catalog) ||
    catalog.schemaVersion !== 1 ||
    catalog.kind !== 'canonical-document-catalog' ||
    catalog.repository !== 'guillermomolina/protos' ||
    catalog.revision !== snapshot.revision ||
    catalog.treeSha !== snapshot.treeSha ||
    !Array.isArray(catalog.entries) ||
    catalog.entries.length > MAX_ENTRIES
  ) {
    throw new Error('Catalog does not match exact source revision');
  }

  let previousPath = '';

  for (let i = 0; i < catalog.entries.length; i++) {
    const entry = catalog.entries[i];
    const prefix = entry && PREFIXES[entry.family];

    if (
      !entry ||
      typeof entry.path !== 'string' ||
      typeof prefix !== 'string' ||
      !entry.path.startsWith(prefix) ||
      entry.path <= previousPath
    ) {
      throw new Error('Invalid or duplicate catalog path');
    }

    const relative = entry.path.slice(prefix.length);

    const selected = sourceCore.selectDocument(
      snapshot,
      catalog,
      entry.family,
      relative,
    );

    if (
      selected.path !== entry.path ||
      selected.blobSha !== entry.blobSha
    ) {
      throw new Error('Invalid catalog document');
    }

    previousPath = entry.path;
  }

  return catalog;
}

function read(cache, snapshot, part) {
  try {
    const raw = cache.get(key(snapshot, part));

    if (
      typeof raw !== 'string' ||
      raw.length === 0 ||
      raw.length > MAX_CACHE_CHARS
    ) {
      return null;
    }

    return validateCatalog(snapshot, JSON.parse(raw));
  } catch (ignoredError) {
    return null;
  }
}

function result(status, state, catalog, cacheStatus) {
  return {
    status,
    state,
    catalog,
    cache: cacheStatus,
  };
}

function fallback(stale) {
  return stale === null
    ? result(503, 'unavailable', null, null)
    : result(200, 'stale', stale, 'STALE');
}

async function loadCatalog(snapshot, dependencies) {
  revisionCore.requireSnapshot(snapshot);

  const cache = dependencies && dependencies.cache;
  const fetcher = dependencies && dependencies.fetcher;

  if (
    !cache ||
    typeof cache.get !== 'function'
  ) {
    return fallback(null);
  }

  const fresh = read(cache, snapshot, 'fresh');

  if (fresh !== null) {
    return result(200, 'fresh', fresh, 'HIT');
  }

  const stale = read(cache, snapshot, 'stale');

  if (typeof fetcher !== 'function') {
    return fallback(stale);
  }

  try {
    if (cache.get(key(snapshot, 'backoff')) === '1') {
      return fallback(stale);
    }
  } catch (ignoredError) {
    return fallback(stale);
  }

  let acquired = false;

  try {
    acquired = cache.add(
      key(snapshot, 'fetching'),
      '1',
      LEASE_MS,
    );
  } catch (ignoredError) {
    return fallback(stale);
  }

  if (!acquired) {
    return fallback(stale);
  }

  try {
    const catalog = validateCatalog(
      snapshot,
      await catalogService.createCatalog(snapshot, fetcher),
    );

    const serialized = JSON.stringify(catalog);

    if (
      serialized.length === 0 ||
      serialized.length > MAX_CACHE_CHARS
    ) {
      throw new Error('Catalog exceeds cache value limit');
    }

    if (
      cache.set(
        key(snapshot, 'stale'),
        serialized,
        STALE_MS,
      ) === false
    ) {
      throw new Error('Stale catalog cache write failed');
    }

    if (
      cache.set(
        key(snapshot, 'fresh'),
        serialized,
        FRESH_MS,
      ) === false
    ) {
      throw new Error('Fresh catalog cache write failed');
    }

    try {
      cache.delete(key(snapshot, 'backoff'));
    } catch (ignoredError) {
      // A complete cached catalog remains valid.
    }

    return result(200, 'fresh', catalog, 'MISS');
  } catch (ignoredError) {
    try {
      cache.set(
        key(snapshot, 'backoff'),
        '1',
        BACKOFF_MS,
      );
    } catch (ignoredCacheError) {
      // Preserve any previously admitted stale catalog.
    }

    return fallback(stale);
  } finally {
    try {
      cache.delete(key(snapshot, 'fetching'));
    } catch (ignoredError) {
      // The lease expires independently of cleanup.
    }
  }
}

export default {
  validateCatalog,
  loadCatalog,
};
