import revisionService from './github-document-revision-service.js';
import catalogCache from './github-document-catalog-cache.js';
import sourceCore from './github-document-source-core.js';
import contentCache from './github-document-content-cache.js';

// WEB011-D4D2-B: fixed development document endpoint.
// Neither revision nor upstream URL can be selected by HTTP callers.

const FAMILIES = [
  'spec',
  'guide',
  'tutorials',
  'examples',
  'library',
];

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;
const MAX_PATH_CHARS = 1024;
const MAX_SEGMENTS = 32;

function parseSelection(args) {
  if (
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args)
  ) {
    return null;
  }

  const keys = Object.keys(args);

  if (
    keys.length !== 2 ||
    !keys.includes('family') ||
    !keys.includes('path')
  ) {
    return null;
  }

  const family = args.family;
  const relativePath = args.path;

  if (
    typeof family !== 'string' ||
    !FAMILIES.includes(family) ||
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.length > MAX_PATH_CHARS
  ) {
    return null;
  }

  const segments = relativePath.split('/');

  if (
    segments.length === 0 ||
    segments.length > MAX_SEGMENTS
  ) {
    return null;
  }

  for (let i = 0; i < segments.length; i++) {
    if (!SEGMENT.test(segments[i])) {
      return null;
    }
  }

  return { family, relativePath };
}

function respond(
  request,
  status,
  state,
  snapshot,
  document,
  cacheStatus,
) {
  request.headersOut['Content-Type'] =
    'application/json; charset=utf-8';

  request.headersOut['Cache-Control'] = 'no-store';

  request.headersOut['X-Content-Type-Options'] = 'nosniff';

  if (cacheStatus) {
    request.headersOut['X-Protos-Cache'] = cacheStatus;
  }

  request.return(status, JSON.stringify({
    schemaVersion: 1,
    kind: 'documentation-document',
    state,
    snapshot,
    document,
  }));
}

async function document(request) {
  if (request.method !== 'GET') {
    request.headersOut.Allow = 'GET';
    respond(request, 405, 'unavailable', null, null, null);
    return;
  }

  const requested = parseSelection(request.args);

  if (requested === null) {
    respond(request, 400, 'unavailable', null, null, null);
    return;
  }

  try {
    const metadataCache = ngx.shared.protos_content;
    const documentCache = ngx.shared.protos_documents;

    if (
      !metadataCache ||
      typeof metadataCache.get !== 'function' ||
      typeof metadataCache.add !== 'function' ||
      typeof metadataCache.set !== 'function' ||
      !documentCache ||
      typeof documentCache.get !== 'function' ||
      typeof documentCache.set !== 'function'
    ) {
      respond(request, 503, 'unavailable', null, null, null);
      return;
    }

    const fetcher = function(url, options) {
      return ngx.fetch(url, options);
    };

    const dependencies = {
      cache: metadataCache,
      fetcher,
    };

    // D3 resolves the only allowed selector: development/main.
    const captured = {
      method: 'GET',
      headersOut: {},
      status: 0,
      payload: null,

      return: function(status, body) {
        this.status = status;
        this.payload = JSON.parse(body);
      },
    };

    await revisionService.serveSnapshot(
      captured,
      { kind: 'development' },
      dependencies,
    );

    if (
      captured.status !== 200 ||
      !captured.payload ||
      !captured.payload.snapshot
    ) {
      respond(request, 503, 'unavailable', null, null, null);
      return;
    }

    const snapshot = captured.payload.snapshot;

    // The catalog must belong to this exact snapshot.
    const listing = await catalogCache.loadCatalog(
      snapshot,
      dependencies,
    );

    if (
      listing.status !== 200 ||
      !listing.catalog
    ) {
      respond(request, 503, 'unavailable', null, null, null);
      return;
    }

    const selection = {
      snapshot,
      catalog: listing.catalog,
      family: requested.family,
      relativePath: requested.relativePath,
    };

    // Reject missing or unadmitted paths before source fetch.
    try {
      sourceCore.selectDocument(
        snapshot,
        listing.catalog,
        requested.family,
        requested.relativePath,
      );
    } catch (ignoredError) {
      respond(request, 404, 'unavailable', null, null, null);
      return;
    }

    const loaded = await contentCache.loadDocument(
      selection,
      {
        metadataCache,
        contentCache: documentCache,
        fetcher,
      },
    );

    if (
      loaded.status !== 200 ||
      !loaded.document
    ) {
      respond(request, 503, 'unavailable', null, null, null);
      return;
    }

    const state = (
      captured.payload.state === 'stale' ||
      listing.state === 'stale' ||
      loaded.state === 'stale'
    ) ? 'stale' : 'fresh';

    respond(
      request,
      200,
      state,
      snapshot,
      loaded.document,
      loaded.cache,
    );
  } catch (ignoredError) {
    respond(request, 503, 'unavailable', null, null, null);
  }
}

export default { document };
