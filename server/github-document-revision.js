import revisionService from './github-document-revision-service.js';

// WEB011-D3: server-owned, fixed development selector.
// Never derive a selector or upstream URL from request arguments.
function dependencies() {
  return {
    cache: ngx.shared.protos_content,
    fetcher: function(url, options) {
      return ngx.fetch(url, options);
    },
  };
}

async function development(request) {
  await revisionService.serveSnapshot(
    request,
    { kind: 'development' },
    dependencies(),
  );
}

export default { development };
