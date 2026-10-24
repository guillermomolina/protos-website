import publicationsCore from './ghcr-d064-publications-core.js';
import publicationsCache from './ghcr-d064-publications-cache.js';
import contentCache from './ghcr-d064-content-cache.js';

// WEB011-D5B2-C3-B: fixed, read-only D064 publication endpoint.
// HTTP callers cannot select a revision, digest, package or upstream URL.

const CACHE_STATES = ['fresh', 'stale'];
const CACHE_LABELS = ['HIT', 'MISS', 'STALE'];

function respond(
  request,
  status,
  state,
  publication,
  document,
  cacheStatus,
) {
  request.headersOut['Content-Type'] =
    'application/json; charset=utf-8';
  request.headersOut['Cache-Control'] = 'no-store';
  request.headersOut['X-Content-Type-Options'] = 'nosniff';

  if (cacheStatus !== null) {
    request.headersOut['X-Protos-Cache'] = cacheStatus;
  }

  request.return(status, JSON.stringify({
    schemaVersion: 1,
    kind: 'protos-d064-publication',
    state,
    publication,
    document,
  }));
}

function unavailable(request, status) {
  respond(
    request,
    status,
    'unavailable',
    null,
    null,
    null,
  );
}

function validMetadataCache(cache) {
  return (
    cache &&
    typeof cache.get === 'function' &&
    typeof cache.add === 'function' &&
    typeof cache.set === 'function'
  );
}

function validContentCache(cache) {
  return (
    cache &&
    typeof cache.get === 'function' &&
    typeof cache.set === 'function'
  );
}

function cacheLabel(indexResult, documentResult) {
  if (
    !CACHE_LABELS.includes(indexResult.cache) ||
    !CACHE_LABELS.includes(documentResult.cache)
  ) {
    return null;
  }

  return (
    'INDEX=' + indexResult.cache +
    ';DOCUMENT=' + documentResult.cache
  );
}

async function serveDocument(request, dependencies) {
  if (request.method !== 'GET') {
    request.headersOut.Allow = 'GET';
    unavailable(request, 405);
    return;
  }

  const args = request.args;

  if (
    args !== undefined &&
    args !== null &&
    (
      typeof args !== 'object' ||
      Array.isArray(args) ||
      Object.keys(args).length !== 0
    )
  ) {
    unavailable(request, 400);
    return;
  }

  try {
    const dependenciesReady = (
      dependencies &&
      validMetadataCache(dependencies.metadataCache) &&
      validContentCache(dependencies.contentCache) &&
      typeof dependencies.fetcher === 'function' &&
      typeof dependencies.sha256 === 'function'
    );

    if (!dependenciesReady) {
      unavailable(request, 503);
      return;
    }

    const loadIndex = dependencies.indexLoader ||
      publicationsCache.loadIndex;

    const loadContent = dependencies.documentLoader ||
      contentCache.loadDocument;

    const indexResult = await loadIndex({
      cache: dependencies.metadataCache,
      fetcher: dependencies.fetcher,
    });

    if (
      !indexResult ||
      indexResult.status !== 200 ||
      !CACHE_STATES.includes(indexResult.state) ||
      !indexResult.index
    ) {
      unavailable(request, 503);
      return;
    }

    // Independently admit the registry before choosing its active X/H/M.
    const admittedIndex = publicationsCore.admitIndex(
      indexResult.index,
    );

    const activeLock = publicationsCore.activeLock(
      admittedIndex,
    );

    const documentResult = await loadContent(
      activeLock,
      {
        metadataCache: dependencies.metadataCache,
        contentCache: dependencies.contentCache,
        fetcher: dependencies.fetcher,
        sha256: dependencies.sha256,
      },
    );

    if (
      !documentResult ||
      documentResult.status !== 200 ||
      !CACHE_STATES.includes(documentResult.state) ||
      !documentResult.document ||
      !documentResult.document.provenance ||
      documentResult.document.provenance.revision !==
        activeLock.sourceRevision
    ) {
      unavailable(request, 503);
      return;
    }

    const state = (
      indexResult.state === 'stale' ||
      documentResult.state === 'stale'
    ) ? 'stale' : 'fresh';

    respond(
      request,
      200,
      state,
      activeLock,
      documentResult.document,
      cacheLabel(indexResult, documentResult),
    );
  } catch (ignoredError) {
    // No upstream, token, digest implementation or internal error
    // details are disclosed in the HTTP response.
    unavailable(request, 503);
  }
}

function runtimeDependencies() {
  if (
    typeof ngx === 'undefined' ||
    !ngx.shared ||
    typeof ngx.fetch !== 'function' ||
    typeof crypto === 'undefined' ||
    !crypto.subtle ||
    typeof crypto.subtle.digest !== 'function' ||
    typeof Buffer === 'undefined'
  ) {
    return null;
  }

  return {
    metadataCache: ngx.shared.protos_content,
    contentCache: ngx.shared.protos_documents,

    fetcher: function(url, options) {
      return ngx.fetch(url, options);
    },

    sha256: async function(bytes) {
      const result = await crypto.subtle.digest(
        'SHA-256',
        bytes,
      );

      return Buffer.from(result).toString('hex');
    },
  };
}

async function document(request) {
  let dependencies = null;

  try {
    dependencies = runtimeDependencies();
  } catch (ignoredError) {
    dependencies = null;
  }

  await serveDocument(request, dependencies);
}

export default {
  document,
  serveDocument,
};
