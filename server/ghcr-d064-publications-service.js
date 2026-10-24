import core from './ghcr-d064-publications-core.js';

// WEB011-D5B2-C1: read-only discovery from one fixed GitHub location.

async function loadIndex(fetcher) {
  if (typeof fetcher !== 'function') {
    throw new Error('D064 publication transport unavailable');
  }

  const response = await fetcher(core.INDEX_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'protos-website-live-docs',
    },
    buffer_size: 4096,
    max_response_body_size: core.MAX_INDEX_BYTES,
  });

  if (
    !response ||
    response.status !== 200 ||
    !response.headers ||
    typeof response.headers.get !== 'function' ||
    typeof response.arrayBuffer !== 'function'
  ) {
    throw new Error('D064 publication registry unavailable');
  }

  const length = response.headers.get('content-length');

  if (length !== null && length !== undefined) {
    if (
      typeof length !== 'string' ||
      !/^(0|[1-9][0-9]*)$/.test(length) ||
      Number(length) > core.MAX_INDEX_BYTES
    ) {
      throw new Error('D064 publication registry exceeds byte limit');
    }
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > core.MAX_INDEX_BYTES
  ) {
    throw new Error('D064 publication registry exceeds byte limit');
  }

  let payload;

  try {
    payload = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (ignoredError) {
    throw new Error('Invalid D064 publication registry JSON');
  }

  return core.admitIndex(payload);
}

export default { loadIndex };
