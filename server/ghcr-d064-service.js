import core from './ghcr-d064-core.js';

// WEB011-D5B2-B: anonymous, exact-digest GHCR transport.
// No caller-controlled URL, tag, repository, redirect host or credential.

const TOKEN_URL =
  'https://ghcr.io/token?' +
  'scope=repository%3Aguillermomolina%2Fprotos-stdlib-documentation%3Apull' +
  '&service=ghcr.io';

const REGISTRY_API =
  'https://ghcr.io/v2/guillermomolina/protos-stdlib-documentation';

const BLOB_CDN_PREFIX =
  'https://pkg-containers.githubusercontent.com/';

const MAX_TOKEN_BYTES = 8192;
const MAX_REDIRECT_CHARS = 8192;

function manifestUrl(lock) {
  return `${REGISTRY_API}/manifests/${lock.d064ManifestDigest}`;
}

function blobUrl(admission) {
  return `${REGISTRY_API}/blobs/${admission.layerDigest}`;
}

function allowedBlobRedirect(location) {
  return (
    typeof location === 'string' &&
    location.length > BLOB_CDN_PREFIX.length &&
    location.length <= MAX_REDIRECT_CHARS &&
    location.startsWith(BLOB_CDN_PREFIX) &&
    !/[\u0000-\u0020\u007f\\#]/.test(location) &&
    /^[\x21-\x7e]+$/.test(location)
  );
}

function responseHeader(response, name) {
  if (
    !response.headers ||
    typeof response.headers.get !== 'function'
  ) {
    throw new Error('Missing GHCR response headers');
  }

  return response.headers.get(name);
}

async function boundedBody(response, maximum) {
  if (!response || typeof response.arrayBuffer !== 'function') {
    throw new Error('Invalid GHCR response');
  }

  const length = responseHeader(response, 'content-length');

  if (length !== null && length !== undefined) {
    if (
      typeof length !== 'string' ||
      !/^(0|[1-9][0-9]*)$/.test(length) ||
      Number(length) > maximum
    ) {
      throw new Error('GHCR response exceeds the byte limit');
    }
  }

  const raw = await response.arrayBuffer();
  const bytes = new Uint8Array(raw);

  if (bytes.byteLength > maximum) {
    throw new Error('GHCR response exceeds the byte limit');
  }

  return bytes;
}

async function request(fetcher, url, headers, maximum) {
  const response = await fetcher(url, {
    method: 'GET',
    headers,
    buffer_size: 4096,
    max_response_body_size: maximum,
  });

  if (
    !response ||
    !Number.isInteger(response.status)
  ) {
    throw new Error('Invalid GHCR transport response');
  }

  return response;
}

async function anonymousToken(fetcher) {
  const response = await request(
    fetcher,
    TOKEN_URL,
    { Accept: 'application/json' },
    MAX_TOKEN_BYTES,
  );

  if (response.status !== 200) {
    throw new Error('GHCR anonymous token unavailable');
  }

  const bytes = await boundedBody(response, MAX_TOKEN_BYTES);
  let payload;

  try {
    payload = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (ignoredError) {
    throw new Error('Invalid GHCR token response');
  }

  const token = payload && payload.token;

  if (
    typeof token !== 'string' ||
    !/^[A-Za-z0-9._~+/=-]{16,4096}$/.test(token)
  ) {
    throw new Error('Invalid GHCR anonymous token');
  }

  return token;
}

async function manifestBytes(lock, token, fetcher) {
  const response = await request(
    fetcher,
    manifestUrl(lock),
    {
      Accept: core.MANIFEST_MEDIA_TYPE,
      Authorization: `Bearer ${token}`,
    },
    core.MAX_MANIFEST_BYTES,
  );

  if (response.status !== 200) {
    throw new Error('Pinned GHCR manifest unavailable');
  }

  return boundedBody(response, core.MAX_MANIFEST_BYTES);
}

async function documentBytes(admission, token, fetcher) {
  const response = await request(
    fetcher,
    blobUrl(admission),
    { Authorization: `Bearer ${token}` },
    core.MAX_DOCUMENT_BYTES,
  );

  if (response.status === 200) {
    return boundedBody(response, core.MAX_DOCUMENT_BYTES);
  }

  // GHCR currently issues an HTTP 307 to GitHub's blob CDN.
  // No arbitrary redirects and, critically, no bearer on the CDN request.
  if (response.status !== 307) {
    throw new Error('Pinned GHCR blob unavailable');
  }

  const location = responseHeader(response, 'location');

  if (!allowedBlobRedirect(location)) {
    throw new Error('Unapproved GHCR blob redirect');
  }

  const redirected = await request(
    fetcher,
    location,
    { Accept: 'application/octet-stream' },
    core.MAX_DOCUMENT_BYTES,
  );

  // A second redirect is deliberately not followed.
  if (redirected.status !== 200) {
    throw new Error('Redirected GHCR blob unavailable');
  }

  return boundedBody(redirected, core.MAX_DOCUMENT_BYTES);
}

async function loadDocument(input, dependencies) {
  // Validate the authoritative lock before any network request.
  const lock = core.admitLock(input);

  if (
    !dependencies ||
    typeof dependencies.fetcher !== 'function' ||
    typeof dependencies.sha256 !== 'function'
  ) {
    throw new Error('GHCR transport dependencies unavailable');
  }

  const fetcher = dependencies.fetcher;
  const sha256 = dependencies.sha256;

  const token = await anonymousToken(fetcher);
  const manifest = await manifestBytes(lock, token, fetcher);

  // M authenticates the raw manifest bytes and binds X/H to one OCI artifact.
  const admission = await core.admitManifest(
    lock,
    manifest,
    sha256,
  );

  const bytes = await documentBytes(admission, token, fetcher);

  // H authenticates the raw D064 bytes; provenance must also match X.
  const document = await core.admitDocument(
    admission,
    bytes,
    sha256,
  );

  return {
    lock,
    document,
    manifestBytes: manifest,
    documentBytes: bytes,
  };
}

export default {
  TOKEN_URL,
  REGISTRY_API,
  allowedBlobRedirect,
  loadDocument,
};
