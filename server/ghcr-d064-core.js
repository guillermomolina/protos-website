// WEB011-D5B2-A: exact-revision OCI/D064 admission.
// Pure contract: no transport, credentials, cache or renderer.

const REPOSITORY = 'guillermomolina/protos';
const PACKAGE = 'ghcr.io/guillermomolina/protos-stdlib-documentation';

const MANIFEST_MEDIA_TYPE =
  'application/vnd.oci.image.manifest.v1+json';
const ARTIFACT_TYPE =
  'application/vnd.protos.stdlib-documentation.v1';
const LAYER_MEDIA_TYPE =
  'application/vnd.protos.stdlib-documentation.v1+json';
const EMPTY_MEDIA_TYPE =
  'application/vnd.oci.empty.v1+json';

const EMPTY_DIGEST =
  'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

const REVISION = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

const MAX_MANIFEST_BYTES = 16384;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

function object(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function admitLock(input) {
  requireValue(object(input), 'Invalid D064 lock');

  const expected = [
    'd064ContentSha256',
    'd064ManifestDigest',
    'kind',
    'schemaVersion',
    'sourceRevision',
  ];

  requireValue(
    JSON.stringify(Object.keys(input).sort()) ===
      JSON.stringify(expected),
    'Unexpected D064 lock fields',
  );

  requireValue(
    input.schemaVersion === 1 &&
    input.kind === 'protos-d064-oci-lock' &&
    typeof input.sourceRevision === 'string' &&
    REVISION.test(input.sourceRevision) &&
    typeof input.d064ContentSha256 === 'string' &&
    HASH.test(input.d064ContentSha256) &&
    typeof input.d064ManifestDigest === 'string' &&
    DIGEST.test(input.d064ManifestDigest),
    'Invalid D064 lock identity',
  );

  return Object.freeze({
    schemaVersion: 1,
    kind: 'protos-d064-oci-lock',
    sourceRevision: input.sourceRevision,
    d064ContentSha256: input.d064ContentSha256,
    d064ManifestDigest: input.d064ManifestDigest,
  });
}

function viewOf(value, limit) {
  let view;

  if (value instanceof ArrayBuffer) {
    view = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    view = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    );
  }

  requireValue(
    view && view.byteLength > 0 && view.byteLength <= limit,
    'Invalid or oversized OCI bytes',
  );

  return view;
}

function parseJson(view) {
  let value;

  try {
    value = JSON.parse(Buffer.from(view).toString('utf8'));
  } catch (ignoredError) {
    throw new Error('Invalid OCI JSON');
  }

  requireValue(object(value), 'OCI JSON must be an object');
  return value;
}

async function checkedHash(view, sha256) {
  requireValue(
    typeof sha256 === 'function',
    'SHA-256 transport dependency missing',
  );

  const actual = await sha256(view);

  requireValue(
    typeof actual === 'string' && HASH.test(actual),
    'SHA-256 dependency returned invalid result',
  );

  return actual;
}

async function admitManifest(lockInput, bytes, sha256) {
  const lock = admitLock(lockInput);
  const view = viewOf(bytes, MAX_MANIFEST_BYTES);

  requireValue(
    `sha256:${await checkedHash(view, sha256)}` ===
      lock.d064ManifestDigest,
    'OCI manifest digest mismatch',
  );

  const manifest = parseJson(view);
  const config = manifest.config;
  const layers = manifest.layers;
  const annotations = manifest.annotations;

  requireValue(
    manifest.schemaVersion === 2 &&
    manifest.mediaType === MANIFEST_MEDIA_TYPE &&
    manifest.artifactType === ARTIFACT_TYPE,
    'Unexpected OCI manifest format',
  );

  requireValue(
    object(config) &&
    config.mediaType === EMPTY_MEDIA_TYPE &&
    config.digest === EMPTY_DIGEST &&
    config.size === 2,
    'Unexpected OCI configuration',
  );

  requireValue(
    Array.isArray(layers) &&
    layers.length === 1 &&
    object(layers[0]),
    'D064 requires exactly one OCI layer',
  );

  const layer = layers[0];

  requireValue(
    layer.mediaType === LAYER_MEDIA_TYPE &&
    layer.digest === `sha256:${lock.d064ContentSha256}` &&
    Number.isInteger(layer.size) &&
    layer.size > 0 &&
    layer.size <= MAX_DOCUMENT_BYTES,
    'OCI D064 layer identity mismatch',
  );

  requireValue(
    object(annotations) &&
    annotations['org.opencontainers.image.revision'] ===
      lock.sourceRevision &&
    annotations['org.opencontainers.image.source'] ===
      `https://github.com/${REPOSITORY}`,
    'OCI source provenance mismatch',
  );

  return Object.freeze({
    lock,
    layerDigest: layer.digest,
    layerSize: layer.size,
  });
}

async function admitDocument(admission, bytes, sha256) {
  requireValue(
    object(admission) &&
    object(admission.lock),
    'Missing admitted OCI manifest',
  );

  const lock = admitLock(admission.lock);
  const view = viewOf(bytes, MAX_DOCUMENT_BYTES);

  requireValue(
    view.byteLength === admission.layerSize,
    'D064 layer size mismatch',
  );

  requireValue(
    await checkedHash(view, sha256) ===
      lock.d064ContentSha256,
    'D064 content digest mismatch',
  );

  const document = parseJson(view);

  requireValue(
    (document.format && document.format.name) === 'protos-documentation' &&
    (document.format && document.format.major) === 1 &&
    (document.provenance && document.provenance.kind) === 'repositoryRevision' &&
    (document.provenance && document.provenance.repository) === REPOSITORY &&
    (document.provenance && document.provenance.revision) === lock.sourceRevision,
    'D064 source provenance mismatch',
  );

  requireValue(
    Array.isArray(document.modules) &&
    Array.isArray(document.symbols) &&
    Array.isArray(document.articles) &&
    Array.isArray(document.relationships),
    'Incomplete D064 document',
  );

  return document;
}

export default {
  PACKAGE,
  MANIFEST_MEDIA_TYPE,
  MAX_MANIFEST_BYTES,
  MAX_DOCUMENT_BYTES,
  admitLock,
  admitManifest,
  admitDocument,
};
