// WEB011-D: read-only Announcements service.
// NGINX supplies shared cache, HTTPS fetch and XML parsing.

const FEED_URL =
  'https://github.com/guillermomolina/protos/discussions/categories/announcements.atom';

const FRESH_TTL_MS = 15 * 60 * 1000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_LEASE_MS = 10 * 1000;
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;
const MAX_FEED_SIZE = 2 * 1024 * 1024;

const FRESH_KEY = 'news:fresh';
const STALE_KEY = 'news:stale';
const LEASE_KEY = 'news:fetching';
const BACKOFF_KEY = 'news:retry-after-failure';

function readCached(cache, key) {
  try {
    const raw = cache.get(key);
    if (typeof raw !== 'string') return null;

    const entries = JSON.parse(raw);

    if (!Array.isArray(entries) || entries.length > 20) {
      return null;
    }

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];

      if (
        !entry ||
        typeof entry.title !== 'string' ||
        typeof entry.date !== 'string' ||
        typeof entry.summary !== 'string' ||
        typeof entry.href !== 'string' ||
        !/^https:\/\/github\.com\/guillermomolina\/protos\/discussions\/[1-9][0-9]*$/.test(
          entry.href
        )
      ) {
        return null;
      }
    }

    return entries;
  } catch (error) {
    return null;
  }
}

function respond(request, status, state, entries, cacheState) {
  request.headersOut['Content-Type'] =
    'application/json; charset=utf-8';
  request.headersOut['Cache-Control'] = 'no-store';
  request.headersOut['X-Protos-Content-State'] = state;

  if (cacheState) {
    request.headersOut['X-Protos-Cache'] = cacheState;
  }

  request.return(
    status,
    JSON.stringify({
      schemaVersion: 1,
      state: state,
      entries: entries || [],
    }),
  );
}

function fallback(request, stale, cacheState) {
  if (stale !== null) {
    respond(request, 200, 'stale', stale, cacheState || 'HIT');
    return;
  }

  respond(request, 503, 'unavailable', [], null);
}

async function serveAnnouncements(request, dependencies) {
  const cache = dependencies && dependencies.cache;
  const fetcher = dependencies && dependencies.fetcher;
  const parseFeed = dependencies && dependencies.parseFeed;

  if (
    !cache ||
    typeof fetcher !== 'function' ||
    typeof parseFeed !== 'function'
  ) {
    respond(request, 503, 'unavailable', [], null);
    return;
  }

  const fresh = readCached(cache, FRESH_KEY);

  if (fresh !== null) {
    respond(request, 200, 'fresh', fresh, 'HIT');
    return;
  }

  const stale = readCached(cache, STALE_KEY);

  try {
    if (cache.get(BACKOFF_KEY) === '1') {
      fallback(request, stale, null);
      return;
    }
  } catch (error) {
    fallback(request, stale, null);
    return;
  }

  let acquired;

  try {
    acquired = cache.add(LEASE_KEY, '1', FETCH_LEASE_MS);
  } catch (error) {
    fallback(request, stale, null);
    return;
  }

  if (!acquired) {
    fallback(request, stale, null);
    return;
  }

  try {
    const response = await fetcher(FEED_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/atom+xml',
        'User-Agent': 'protos-website-dynamic-content',
      },
      max_response_body_size: MAX_FEED_SIZE,
    });

    if (response.status !== 200) {
      throw new Error(
        `GitHub Announcements HTTP ${response.status}`
      );
    }

    const raw = await response.text();

    if (
      typeof raw !== 'string' ||
      raw.length === 0 ||
      raw.length > MAX_FEED_SIZE
    ) {
      throw new Error('Invalid Atom response size');
    }

    const entries = parseFeed(raw);

    if (!Array.isArray(entries) || entries.length > 20) {
      throw new Error('Invalid normalized announcements');
    }

    const serialized = JSON.stringify(entries);

    cache.set(FRESH_KEY, serialized, FRESH_TTL_MS);
    cache.set(STALE_KEY, serialized, STALE_TTL_MS);

    try {
      cache.delete(BACKOFF_KEY);
    } catch (error) {
      // Cache cleanup does not invalidate valid news.
    }

    respond(request, 200, 'fresh', entries, 'MISS');
  } catch (error) {
    try {
      cache.set(BACKOFF_KEY, '1', FAILURE_BACKOFF_MS);
    } catch (cacheError) {
      // Preserve the stale fallback on cache failure.
    }

    fallback(request, stale, null);
  } finally {
    try {
      cache.delete(LEASE_KEY);
    } catch (error) {
      // The website remains available on cache errors.
    }
  }
}

export default {
  serveAnnouncements: serveAnnouncements,
};
