import sourceCore from './github-document-source-core.js';
import sourceService from './github-document-source-service.js';

// WEB011-D4D2-A: exact-revision canonical document cache.
//
// metadataCache contains leases, fresh markers and backoff.
// contentCache contains bounded document bodies.
// An evicting content zone cannot evict metadata or catalog leases.

const FRESH_MS = 15 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const BACKOFF_MS = 60 * 1000;
const LEASE_MS = 20 * 1000;

const MAX_CACHE_CHARS = 1024 * 1024;
const MAX_KEY_CHARS = 4096;

function key(descriptor) {
  const value = [
    'docs:content',
    descriptor.revision,
    descriptor.blobSha,
    descriptor.family,
    descriptor.path,
  ].join(':');

  if (value.length > MAX_KEY_CHARS) {
    throw new Error('Document cache key exceeds limit');
  }

  return value;
}

function validateDocument(descriptor, document) {
  if (
    !document ||
    typeof document !== 'object' ||
    Array.isArray(document) ||
    document.schemaVersion !== 1 ||
    document.kind !== 'canonical-document' ||
    document.repository !== descriptor.repository ||
    document.revision !== descriptor.revision ||
    document.treeSha !== descriptor.treeSha ||
    document.family !== descriptor.family ||
    document.path !== descriptor.path ||
    document.sourceUrl !== descriptor.sourceUrl ||
    document.contentKind !== descriptor.contentKind
  ) {
    throw new Error('Document identity mismatch');
  }

  return sourceCore.normalizeSource(
    descriptor,
    document.content,
  );
}

function readContent(cache, prefix, descriptor) {
  try {
    const raw = cache.get(`${prefix}:data`);

    if (
      typeof raw !== 'string' ||
      raw.length === 0 ||
      raw.length > MAX_CACHE_CHARS
    ) {
      return null;
    }

    const entry = JSON.parse(raw);

    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      entry.schemaVersion !== 1 ||
      entry.blobSha !== descriptor.blobSha
    ) {
      return null;
    }

    return validateDocument(
      descriptor,
      entry.document,
    );
  } catch (ignoredError) {
    return null;
  }
}

function result(status, state, document, cacheStatus) {
  return {
    status,
    state,
    document,
    cache: cacheStatus,
  };
}

function fallback(stale) {
  return stale === null
    ? result(503, 'unavailable', null, null)
    : result(200, 'stale', stale, 'STALE');
}

async function loadDocument(selection, dependencies) {
  // Admission happens before cache access and transport.
  // The caller must supply a trusted snapshot and catalog.
  const descriptor = sourceCore.selectDocument(
    selection.snapshot,
    selection.catalog,
    selection.family,
    selection.relativePath,
  );

  const prefix = key(descriptor);

  const metadataCache =
    dependencies && dependencies.metadataCache;

  const contentCache =
    dependencies && dependencies.contentCache;

  const fetcher =
    dependencies && dependencies.fetcher;

  if (
    !metadataCache ||
    typeof metadataCache.get !== 'function' ||
    typeof metadataCache.add !== 'function' ||
    typeof metadataCache.set !== 'function' ||
    !contentCache ||
    typeof contentCache.get !== 'function' ||
    typeof contentCache.set !== 'function'
  ) {
    return fallback(null);
  }

  const cached = readContent(
    contentCache,
    prefix,
    descriptor,
  );

  try {
    if (
      cached !== null &&
      metadataCache.get(`${prefix}:fresh`) === '1'
    ) {
      return result(200, 'fresh', cached, 'HIT');
    }

    if (
      metadataCache.get(`${prefix}:backoff`) === '1'
    ) {
      return fallback(cached);
    }
  } catch (ignoredError) {
    return fallback(cached);
  }

  if (typeof fetcher !== 'function') {
    return fallback(cached);
  }

  let acquired = false;

  try {
    acquired = metadataCache.add(
      `${prefix}:fetching`,
      '1',
      LEASE_MS,
    );
  } catch (ignoredError) {
    return fallback(cached);
  }

  if (!acquired) {
    return fallback(cached);
  }

  try {
    const loaded = await sourceService.loadDocument(
      selection,
      { fetcher },
    );

    const document = validateDocument(
      descriptor,
      loaded,
    );

    const serialized = JSON.stringify({
      schemaVersion: 1,
      blobSha: descriptor.blobSha,
      document,
    });

    if (
      serialized.length === 0 ||
      serialized.length > MAX_CACHE_CHARS
    ) {
      throw new Error('Document exceeds cache limit');
    }

    if (
      contentCache.set(
        `${prefix}:data`,
        serialized,
        STALE_MS,
      ) === false
    ) {
      throw new Error('Content cache write failed');
    }

    if (
      metadataCache.set(
        `${prefix}:fresh`,
        '1',
        FRESH_MS,
      ) === false
    ) {
      throw new Error('Fresh marker write failed');
    }

    try {
      metadataCache.delete(`${prefix}:backoff`);
    } catch (ignoredError) {
      // A valid document remains available independently.
    }

    return result(200, 'fresh', document, 'MISS');
  } catch (ignoredError) {
    try {
      metadataCache.set(
        `${prefix}:backoff`,
        '1',
        BACKOFF_MS,
      );
    } catch (ignoredCacheError) {
      // Preserve independently validated stale content.
    }

    return fallback(cached);
  } finally {
    try {
      metadataCache.delete(`${prefix}:fetching`);
    } catch (ignoredError) {
      // The bounded lease expires independently.
    }
  }
}

export default { loadDocument };
