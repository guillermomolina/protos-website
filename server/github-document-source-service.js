import sourceCore from './github-document-source-core.js';

// WEB011-D4A: a pure, unexposed fetch service.
// The catalog must be admitted independently from the same exact Git tree.
// Neither catalog nor selector may originate directly from an HTTP request.

async function loadDocument(selection, dependencies) {
  const descriptor = sourceCore.selectDocument(
    selection.snapshot,
    selection.catalog,
    selection.family,
    selection.relativePath,
  );

  if (
    !dependencies ||
    typeof dependencies.fetcher !== 'function'
  ) {
    throw new Error('Canonical source transport unavailable');
  }

  const response = await dependencies.fetcher(
    descriptor.rawUrl,
    {
      method: 'GET',
      headers: {
        Accept: 'text/plain',
      },
      max_response_body_size: 262144,
    },
  );

  if (!response || response.status !== 200) {
    throw new Error('Canonical source fetch failed');
  }

  const body = await response.text();

  return sourceCore.normalizeSource(descriptor, body);
}

export default { loadDocument };
