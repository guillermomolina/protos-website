import revisionService from './github-document-revision-service.js';
import catalogCache from './github-document-catalog-cache.js';

// WEB011-D4D1: fixed development catalog, exact SHA throughout.
// Public callers cannot select a branch, tag, commit or upstream URL.

function respond(request, status, state, snapshot, catalog, cacheStatus) {
  request.headersOut['Content-Type'] =
    'application/json; charset=utf-8';
  request.headersOut['Cache-Control'] = 'no-store';
  request.headersOut['X-Content-Type-Options'] = 'nosniff';

  if (cacheStatus) {
    request.headersOut['X-Protos-Cache'] = cacheStatus;
  }

  request.return(status, JSON.stringify({
    schemaVersion: 1,
    kind: 'documentation-catalog',
    state,
    snapshot,
    catalog,
  }));
}

async function catalog(request) {
  if (request.method !== 'GET') {
    request.headersOut.Allow = 'GET';
    respond(request, 405, 'unavailable', null, null, null);
    return;
  }

  try {
    const dependencies = {
      cache: ngx.shared.protos_content,
      fetcher: function(url, options) {
        return ngx.fetch(url, options);
      },
    };

    // Capture D3's already-tested resolver result without writing an
    // intermediate response to the actual HTTP request.
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

    // The catalog receives the one snapshot selected above.
    // All subsequent tree requests use snapshot.treeSha.
    const listing = await catalogCache.loadCatalog(
      snapshot,
      dependencies,
    );

    if (listing.status !== 200 || !listing.catalog) {
      respond(request, 503, 'unavailable', null, null, null);
      return;
    }

    const state = (
      captured.payload.state === 'stale' ||
      listing.state === 'stale'
    ) ? 'stale' : 'fresh';

    respond(
      request,
      200,
      state,
      snapshot,
      listing.catalog,
      listing.cache,
    );
  } catch (ignoredError) {
    respond(request, 503, 'unavailable', null, null, null);
  }
}

export default { catalog };
