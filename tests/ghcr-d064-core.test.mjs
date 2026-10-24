import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import core from '../server/ghcr-d064-core.js';

const revision = 'a'.repeat(40);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function sha256(bytes) {
  return digest(bytes);
}

function fixture() {
  const document = {
    format: { name: 'protos-documentation', major: 1 },
    provenance: {
      kind: 'repositoryRevision',
      repository: 'guillermomolina/protos',
      revision,
    },
    modules: [],
    symbols: [],
    articles: [],
    relationships: [],
  };

  const contentBytes = Buffer.from(JSON.stringify(document));
  const contentHash = digest(contentBytes);

  const manifest = {
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    artifactType: 'application/vnd.protos.stdlib-documentation.v1',
    config: {
      mediaType: 'application/vnd.oci.empty.v1+json',
      digest:
        'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
      size: 2,
    },
    layers: [{
      mediaType: 'application/vnd.protos.stdlib-documentation.v1+json',
      digest: `sha256:${contentHash}`,
      size: contentBytes.byteLength,
    }],
    annotations: {
      'org.opencontainers.image.revision': revision,
      'org.opencontainers.image.source':
        'https://github.com/guillermomolina/protos',
    },
  };

  const manifestBytes = Buffer.from(JSON.stringify(manifest));

  const lock = {
    schemaVersion: 1,
    kind: 'protos-d064-oci-lock',
    sourceRevision: revision,
    d064ContentSha256: contentHash,
    d064ManifestDigest: `sha256:${digest(manifestBytes)}`,
  };

  return { document, manifest, contentBytes, manifestBytes, lock };
}

test('exact X/H/M admits the canonical D064 bytes', async () => {
  const f = fixture();
  const admitted = await core.admitManifest(
    f.lock, f.manifestBytes, sha256,
  );

  assert.equal(admitted.lock.sourceRevision, revision);
  assert.equal(admitted.layerSize, f.contentBytes.byteLength);

  const document = await core.admitDocument(
    admitted, f.contentBytes, sha256,
  );

  assert.deepEqual(document, f.document);
});

test('mutable alias is not part of the authoritative lock', () => {
  const f = fixture();

  assert.throws(() => core.admitLock({
    ...f.lock,
    discoveryAlias: `rev-${revision}`,
  }));
});

test('malformed revision and digest are rejected', () => {
  const f = fixture();

  assert.throws(() => core.admitLock({
    ...f.lock,
    sourceRevision: 'main',
  }));

  assert.throws(() => core.admitLock({
    ...f.lock,
    d064ManifestDigest: 'sha256:invalid',
  }));
});

test('modified manifest bytes cannot retain M', async () => {
  const f = fixture();
  const altered = Buffer.from(
    JSON.stringify({ ...f.manifest, unexpected: true }),
  );

  await assert.rejects(
    core.admitManifest(f.lock, altered, sha256),
    /digest mismatch/,
  );
});

test('extra OCI layers fail after recomputing M', async () => {
  const f = fixture();
  const altered = {
    ...f.manifest,
    layers: [...f.manifest.layers, f.manifest.layers[0]],
  };
  const bytes = Buffer.from(JSON.stringify(altered));

  const lock = {
    ...f.lock,
    d064ManifestDigest: `sha256:${digest(bytes)}`,
  };

  await assert.rejects(
    core.admitManifest(lock, bytes, sha256),
    /exactly one OCI layer/,
  );
});

test('wrong D064 layer digest fails after recomputing M', async () => {
  const f = fixture();
  const altered = {
    ...f.manifest,
    layers: [{
      ...f.manifest.layers[0],
      digest: `sha256:${'f'.repeat(64)}`,
    }],
  };
  const bytes = Buffer.from(JSON.stringify(altered));

  const lock = {
    ...f.lock,
    d064ManifestDigest: `sha256:${digest(bytes)}`,
  };

  await assert.rejects(
    core.admitManifest(lock, bytes, sha256),
    /layer identity mismatch/,
  );
});

test('modified D064 bytes cannot retain H', async () => {
  const f = fixture();
  const admitted = await core.admitManifest(
    f.lock, f.manifestBytes, sha256,
  );

  const altered = Buffer.from(f.contentBytes);
  altered[0] ^= 1;

  await assert.rejects(
    core.admitDocument(admitted, altered, sha256),
    /content digest mismatch/,
  );
});

test('foreign provenance fails despite valid recomputed hashes', async () => {
  const f = fixture();

  const foreign = {
    ...f.document,
    provenance: {
      ...f.document.provenance,
      revision: 'b'.repeat(40),
    },
  };

  const contentBytes = Buffer.from(JSON.stringify(foreign));
  const hash = digest(contentBytes);

  const manifest = {
    ...f.manifest,
    layers: [{
      ...f.manifest.layers[0],
      digest: `sha256:${hash}`,
      size: contentBytes.byteLength,
    }],
  };

  const manifestBytes = Buffer.from(JSON.stringify(manifest));

  const lock = {
    ...f.lock,
    d064ContentSha256: hash,
    d064ManifestDigest: `sha256:${digest(manifestBytes)}`,
  };

  const admitted = await core.admitManifest(
    lock, manifestBytes, sha256,
  );

  await assert.rejects(
    core.admitDocument(admitted, contentBytes, sha256),
    /source provenance mismatch/,
  );
});

test('oversized manifest is rejected before JSON parsing', async () => {
  const f = fixture();

  await assert.rejects(
    core.admitManifest(
      f.lock,
      Buffer.alloc(core.MAX_MANIFEST_BYTES + 1),
      sha256,
    ),
    /oversized OCI bytes/,
  );
});
