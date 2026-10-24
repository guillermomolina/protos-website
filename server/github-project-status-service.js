import core from './github-project-status-core.js';

const ISSUES_UPSTREAM = core.ISSUES_UPSTREAM;
const ACTIONS_UPSTREAM = core.ACTIONS_UPSTREAM;
const normalizeOpenIssues = core.normalizeOpenIssues;
const normalizeWorkflowRuns = core.normalizeWorkflowRuns;

const MODES = {
  issues: {
    url: ISSUES_UPSTREAM,
    normalize: normalizeOpenIssues,
    scope: 'recent-open-issues',
  },
  actions: {
    url: ACTIONS_UPSTREAM,
    normalize: normalizeWorkflowRuns,
    scope: 'recent-workflow-runs',
  },
};

const FRESH_MS = 15 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const BACKOFF_MS = 60 * 1000;
const LEASE_MS = 20 * 1000;
const BODY_LIMIT = 768 * 1024;
const CACHE_LIMIT = 32 * 1024;

function key(kind, part) {
  return `project:${kind}:${part}`;
}

function cached(cache, kind, part) {
  try {
    const data = JSON.parse(cache.get(key(kind, part)));

    if (
      data?.schemaVersion !== 1 ||
      data.kind !== kind ||
      data.scope !== MODES[kind].scope ||
      data.sampled !== true ||
      !Array.isArray(data.entries)
    ) {
      return null;
    }

    return data;
  } catch (ignoredError) {
    return null;
  }
}

function reply(request, code, kind, state, data, cacheStatus) {
  request.headersOut['Content-Type'] =
    'application/json; charset=utf-8';

  request.headersOut['Cache-Control'] = 'no-store';
  request.headersOut['X-Content-Type-Options'] = 'nosniff';

  if (cacheStatus) {
    request.headersOut['X-Protos-Cache'] = cacheStatus;
  }

  request.return(code, JSON.stringify({
    schemaVersion: 1,
    kind,
    scope: MODES[kind].scope,
    sampled: true,
    state,
    entries: data?.entries ?? [],
  }));
}

function fallback(request, kind, stale) {
  if (stale) {
    reply(request, 200, kind, 'stale', stale, 'STALE');
  } else {
    reply(request, 503, kind, 'unavailable', null, null);
  }
}

async function serveProjectStatus(request, kind, dependencies) {
  const mode = MODES[kind];

  if (!mode) {
    throw new Error('Unsupported project status kind');
  }

  if (request.method !== 'GET') {
    request.headersOut.Allow = 'GET';
    reply(request, 405, kind, 'unavailable', null, null);
    return;
  }

  const cache = dependencies?.cache;
  const fetcher = dependencies?.fetcher;

  if (!cache || typeof fetcher !== 'function') {
    fallback(request, kind, null);
    return;
  }

  const fresh = cached(cache, kind, 'fresh');

  if (fresh) {
    reply(request, 200, kind, 'fresh', fresh, 'HIT');
    return;
  }

  const stale = cached(cache, kind, 'stale');

  try {
    if (cache.get(key(kind, 'backoff')) === '1') {
      fallback(request, kind, stale);
      return;
    }
  } catch (ignoredError) {
    fallback(request, kind, stale);
    return;
  }

  let acquired = false;

  try {
    acquired = cache.add(
      key(kind, 'fetching'),
      '1',
      LEASE_MS,
    );
  } catch (ignoredError) {
    fallback(request, kind, stale);
    return;
  }

  if (!acquired) {
    fallback(request, kind, stale);
    return;
  }

  try {
    const response = await fetcher(mode.url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'protos-website-live-status',
      },
    });

    if (response.status !== 200) {
      throw new Error('Upstream HTTP failure');
    }

    const body = await response.text();

    if (
      typeof body !== 'string' ||
      body.length > BODY_LIMIT
    ) {
      throw new Error('Upstream body over limit');
    }

    const normalized = mode.normalize(JSON.parse(body));
    const serialized = JSON.stringify(normalized);

    if (serialized.length > CACHE_LIMIT) {
      throw new Error('Normalized status over limit');
    }

    cache.set(
      key(kind, 'stale'),
      serialized,
      STALE_MS,
    );

    cache.set(
      key(kind, 'fresh'),
      serialized,
      FRESH_MS,
    );

    try {
      cache.delete(key(kind, 'backoff'));
    } catch (ignoredError) {
      // Cache cleanup is best effort.
    }

    reply(request, 200, kind, 'fresh', normalized, 'MISS');
  } catch (ignoredError) {
    try {
      cache.set(
        key(kind, 'backoff'),
        '1',
        BACKOFF_MS,
      );
    } catch (ignoredError) {
      // Preserve the last known good response.
    }

    fallback(request, kind, stale);
  } finally {
    try {
      cache.delete(key(kind, 'fetching'));
    } catch (ignoredError) {
      // The lease also has an expiration time.
    }
  }
}

function serveIssues(request, deps) {
  return serveProjectStatus(request, 'issues', deps);
}

function serveActions(request, deps) {
  return serveProjectStatus(request, 'actions', deps);
}

export default { serveProjectStatus, serveIssues, serveActions };
