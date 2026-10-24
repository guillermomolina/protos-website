import core from './ghcr-d064-core.js';
import service from './ghcr-d064-service.js';

// WEB011-D5B2-C3-A: content-addressed D064 cache.
//
// Metadata: leases, freshness markers and backoff.
// Content: exact original manifest and D064 bytes, reverified on every read.
//
// A cache entry from another X/H/M can never satisfy the selected lock.

const FRESH_MS = 15 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const BACKOFF_MS = 60 * 1000;
const LEASE_MS = 20 * 1000;

const MAX_CACHE_CHARS = 3 * 1024 * 1024;

function prefix(lock) {
  return [
    'd064:content',
    lock.sourceRevision,
    lock.d064ContentSha256,
    lock.d064ManifestDigest.slice(7),
  ].join(':');
}

function identicalLock(expected, actual) {
  return (
    expected.sourceRevision === actual.sourceRevision &&
    expected.d064ContentSha256 === actual.d064ContentSha256 &&
    expected.d064ManifestDigest === actual.d064ManifestDigest
  );
}

function decodeBase64(value, maximum) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > Math.ceil(maximum / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error('Invalid cached D064 byte encoding');
  }

  const bytes = Buffer.from(value, 'base64');

  if (
    bytes.length === 0 ||
    bytes.length > maximum ||
    bytes.toString('base64') !== value
  ) {
    throw new Error('Invalid cached D064 bytes');
  }

  return bytes;
}

async function readContent(cache, name, lock, sha256) {
  try {
    const raw = cache.get(`${name}:data`);

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
      !entry.lock
    ) {
      return null;
    }

    const storedLock = core.admitLock(entry.lock);

    if (!identicalLock(lock, storedLock)) {
      return null;
    }

    const manifest = decodeBase64(
      entry.manifest,
      core.MAX_MANIFEST_BYTES,
    );

    const documentBytes = decodeBase64(
      entry.document,
      core.MAX_DOCUMENT_BYTES,
    );

    const admission = await core.admitManifest(
      lock,
      manifest,
      sha256,
    );

    return await core.admitDocument(
      admission,
      documentBytes,
      sha256,
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

async function loadDocument(input, dependencies) {
  const lock = core.admitLock(input);
  const name = prefix(lock);

  const metadataCache =
    dependencies && dependencies.metadataCache;

  const contentCache =
    dependencies && dependencies.contentCache;

  const fetcher =
    dependencies && dependencies.fetcher;

  const sha256 =
    dependencies && dependencies.sha256;

  if (
    !metadataCache ||
    typeof metadataCache.get !== 'function' ||
    typeof metadataCache.add !== 'function' ||
    typeof metadataCache.set !== 'function' ||
    !contentCache ||
    typeof contentCache.get !== 'function' ||
    typeof contentCache.set !== 'function' ||
    typeof sha256 !== 'function'
  ) {
    return fallback(null);
  }

  const cached = await readContent(
    contentCache,
    name,
    lock,
    sha256,
  );

  try {
    if (
      cached !== null &&
      metadataCache.get(`${name}:fresh`) === '1'
    ) {
      return result(200, 'fresh', cached, 'HIT');
    }

    if (metadataCache.get(`${name}:backoff`) === '1') {
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
      `${name}:fetching`,
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
    const loaded = await service.loadDocument(
      lock,
      { fetcher, sha256 },
    );

    if (
      !loaded ||
      !loaded.lock ||
      !identicalLock(lock, loaded.lock)
    ) {
      throw new Error('D064 loaded identity mismatch');
    }

    const serialized = JSON.stringify({
      schemaVersion: 1,
      lock,
      manifest: Buffer.from(loaded.manifestBytes).toString('base64'),
      document: Buffer.from(loaded.documentBytes).toString('base64'),
    });

    if (
      serialized.length === 0 ||
      serialized.length > MAX_CACHE_CHARS
    ) {
      throw new Error('D064 content exceeds cache limit');
    }

    if (
      contentCache.set(
        `${name}:data`,
        serialized,
        STALE_MS,
      ) === false
    ) {
      throw new Error('D064 content cache write failed');
    }

    if (
      metadataCache.set(
        `${name}:fresh`,
        '1',
        FRESH_MS,
      ) === false
    ) {
      throw new Error('D064 freshness marker write failed');
    }

    try {
      metadataCache.delete(`${name}:backoff`);
    } catch (ignoredError) {
      // Verified content remains independently usable.
    }

    return result(200, 'fresh', loaded.document, 'MISS');
  } catch (ignoredError) {
    try {
      metadataCache.set(
        `${name}:backoff`,
        '1',
        BACKOFF_MS,
      );
    } catch (ignoredCacheError) {
      // Preserve any already-verified cached content.
    }

    return fallback(cached);
  } finally {
    try {
      metadataCache.delete(`${name}:fetching`);
    } catch (ignoredError) {
      // The lease expires independently.
    }
  }
}

export default { loadDocument };
