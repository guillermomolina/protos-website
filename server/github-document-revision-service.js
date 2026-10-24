import revisionCore from './github-document-revision-core.js';

// WEB011-D2: server-selected selectors only, never raw request arguments.
// Any public release picker must first admit its tag from an authoritative
// server-side release inventory to prevent unbounded cache-key cardinality.

const FRESH_MS = 15 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 20 * 1000;
const BACKOFF_MS = 60 * 1000;

const MAX_UPSTREAM_CHARS = 1024 * 1024;
const MAX_CACHE_CHARS = 2048;

function identity(selector) {
  const endpoint = revisionCore.commitEndpoint(selector);
  const ref = selector.kind === 'development'
    ? 'main'
    : selector.tag;

  const suffix = selector.kind === 'development'
    ? 'development'
    : `release:${ref}`;

  return { endpoint, ref, suffix };
}

function cacheKey(suffix, part) {
  return `docs:revision:${suffix}:${part}`;
}

function readSnapshot(cache, selector, suffix, part) {
  try {
    const raw = cache.get(cacheKey(suffix, part));

    if (typeof raw !== 'string') {
      return null;
    }

    const snapshot = revisionCore.requireSnapshot(
      JSON.parse(raw),
    );

    const ref = selector.kind === 'development'
      ? 'main'
      : selector.tag;

    if (
      snapshot.kind !== selector.kind ||
      snapshot.ref !== ref
    ) {
      return null;
    }

    return snapshot;
  } catch (ignoredError) {
    return null;
  }
}

function respond(request, code, state, snapshot, cacheStatus) {
  request.headersOut['Content-Type'] =
    'application/json; charset=utf-8';

  request.headersOut['Cache-Control'] = 'no-store';
  request.headersOut['X-Content-Type-Options'] = 'nosniff';

  if (cacheStatus) {
    request.headersOut['X-Protos-Cache'] = cacheStatus;
  }

  request.return(code, JSON.stringify({
    schemaVersion: 1,
    kind: 'documentation-snapshot',
    state,
    snapshot,
  }));
}

function fallback(request, stale) {
  if (stale !== null) {
    respond(request, 200, 'stale', stale, 'STALE');
  } else {
    respond(request, 503, 'unavailable', null, null);
  }
}

async function serveSnapshot(request, selector, dependencies) {
  // The selector must be provided by trusted server-side routing.
  const source = identity(selector);

  if (request.method !== 'GET') {
    request.headersOut.Allow = 'GET';
    respond(request, 405, 'unavailable', null, null);
    return;
  }

  const cache = dependencies?.cache;
  const fetcher = dependencies?.fetcher;

  if (!cache || typeof fetcher !== 'function') {
    fallback(request, null);
    return;
  }

  const fresh = readSnapshot(
    cache, selector, source.suffix, 'fresh',
  );

  if (fresh !== null) {
    respond(request, 200, 'fresh', fresh, 'HIT');
    return;
  }

  const stale = readSnapshot(
    cache, selector, source.suffix, 'stale',
  );

  try {
    if (
      cache.get(cacheKey(source.suffix, 'backoff')) === '1'
    ) {
      fallback(request, stale);
      return;
    }
  } catch (ignoredError) {
    fallback(request, stale);
    return;
  }

  let acquired = false;

  try {
    acquired = cache.add(
      cacheKey(source.suffix, 'fetching'),
      '1',
      LEASE_MS,
    );
  } catch (ignoredError) {
    fallback(request, stale);
    return;
  }

  if (!acquired) {
    fallback(request, stale);
    return;
  }

  try {
    const response = await fetcher(source.endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'protos-website-live-docs',
      },
    });

    if (response.status !== 200) {
      throw new Error('GitHub commit resolution failed');
    }

    const body = await response.text();

    if (
      typeof body !== 'string' ||
      body.length > MAX_UPSTREAM_CHARS
    ) {
      throw new Error('GitHub commit response over limit');
    }

    const snapshot = revisionCore.normalizeCommit(
      selector,
      JSON.parse(body),
    );

    const serialized = JSON.stringify(snapshot);

    if (serialized.length > MAX_CACHE_CHARS) {
      throw new Error('Snapshot over cache limit');
    }

    cache.set(
      cacheKey(source.suffix, 'stale'),
      serialized,
      STALE_MS,
    );

    cache.set(
      cacheKey(source.suffix, 'fresh'),
      serialized,
      FRESH_MS,
    );

    try {
      cache.delete(cacheKey(source.suffix, 'backoff'));
    } catch (ignoredError) {
      // Cache cleanup does not invalidate a good snapshot.
    }

    respond(request, 200, 'fresh', snapshot, 'MISS');
  } catch (ignoredError) {
    try {
      cache.set(
        cacheKey(source.suffix, 'backoff'),
        '1',
        BACKOFF_MS,
      );
    } catch (ignoredCacheError) {
      // Preserve any independently valid stale snapshot.
    }

    fallback(request, stale);
  } finally {
    try {
      cache.delete(cacheKey(source.suffix, 'fetching'));
    } catch (ignoredError) {
      // The lease expires independently of cleanup.
    }
  }
}

export default { serveSnapshot };
