import core from './ghcr-d064-publications-core.js';
import service from './ghcr-d064-publications-service.js';

// WEB011-D5B2-C2: shared, bounded cache for the website-owned D064 registry.
// Only the fixed upstream registry can refresh this state.

const FRESH_MS = 15 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const BACKOFF_MS = 60 * 1000;
const LEASE_MS = 60 * 1000;

const PREFIX = 'd064:publications';
const MAX_CACHE_CHARS = core.MAX_INDEX_BYTES;

function key(part) {
  return `${PREFIX}:${part}`;
}

function read(cache, part) {
  try {
    const raw = cache.get(key(part));

    if (
      typeof raw !== 'string' ||
      raw.length === 0 ||
      raw.length > MAX_CACHE_CHARS
    ) {
      return null;
    }

    return core.admitIndex(JSON.parse(raw));
  } catch (ignoredError) {
    return null;
  }
}

function result(status, state, index, cacheStatus) {
  return {
    status,
    state,
    index,
    cache: cacheStatus,
  };
}

function fallback(stale) {
  return stale === null
    ? result(503, 'unavailable', null, null)
    : result(200, 'stale', stale, 'STALE');
}

async function loadIndex(dependencies) {
  const cache = dependencies && dependencies.cache;
  const fetcher = dependencies && dependencies.fetcher;

  if (
    !cache ||
    typeof cache.get !== 'function' ||
    typeof cache.add !== 'function' ||
    typeof cache.set !== 'function'
  ) {
    return fallback(null);
  }

  const fresh = read(cache, 'fresh');

  if (fresh !== null) {
    return result(200, 'fresh', fresh, 'HIT');
  }

  const stale = read(cache, 'stale');

  if (typeof fetcher !== 'function') {
    return fallback(stale);
  }

  try {
    if (cache.get(key('backoff')) === '1') {
      return fallback(stale);
    }
  } catch (ignoredError) {
    return fallback(stale);
  }

  let acquired = false;

  try {
    acquired = cache.add(
      key('fetching'),
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
    const index = core.admitIndex(
      await service.loadIndex(fetcher),
    );

    const serialized = JSON.stringify(index);

    if (
      serialized.length === 0 ||
      serialized.length > MAX_CACHE_CHARS
    ) {
      throw new Error('D064 registry exceeds cache limit');
    }

    if (
      cache.set(
        key('stale'),
        serialized,
        STALE_MS,
      ) === false
    ) {
      throw new Error('D064 stale registry write failed');
    }

    if (
      cache.set(
        key('fresh'),
        serialized,
        FRESH_MS,
      ) === false
    ) {
      throw new Error('D064 fresh registry write failed');
    }

    try {
      cache.delete(key('backoff'));
    } catch (ignoredError) {
      // Valid cache entries remain usable.
    }

    return result(200, 'fresh', index, 'MISS');
  } catch (ignoredError) {
    try {
      cache.set(
        key('backoff'),
        '1',
        BACKOFF_MS,
      );
    } catch (ignoredCacheError) {
      // Preserve previously admitted stale state.
    }

    return fallback(stale);
  } finally {
    try {
      cache.delete(key('fetching'));
    } catch (ignoredError) {
      // The lease also expires independently.
    }
  }
}

export default { loadIndex };
