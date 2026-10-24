import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import service from '../server/ghcr-d064-service.js';
import core from '../server/ghcr-d064-core.js';

const X = 'a'.repeat(40);
const TOKEN = 'public-read-token.0123456789';
const CDN =
  'https://pkg-containers.githubusercontent.com/ghcr1/blobs/test' +
  '?signature=fixture';

function digest(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

async function sha256(bytes) {
  return digest(bytes);
}

function reply(status, data = '', headers = {}) {
  const bytes = Buffer.from(data);
  const normalized = Object.create(null);

  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }

  return {
    status,
    headers: {
      get(name) {
        return normalized[name.toLowerCase()] ?? null;
      },
    },
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer;
    },
  };
}

function fixture() {
  const document = Buffer.from(JSON.stringify({
    format: {
      name: 'protos-documentation',
      major: 1,
      minor: 0,
    },
    provenance: {
      kind: 'repositoryRevision',
      repository: 'guillermomolina/protos',
      revision: X,
    },
    modules: [],
    symbols: [],
    articles: [],
    relationships: [],
  }));

  const H = digest(document);

  const manifest = Buffer.from(JSON.stringify({
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
      digest: `sha256:${H}`,
      size: document.length,
      annotations: {
        'org.opencontainers.image.title': 'stdlib-documentation.json',
      },
    }],
    annotations: {
      'org.opencontainers.image.revision': X,
      'org.opencontainers.image.source':
        'https://github.com/guillermomolina/protos',
    },
  }));

  const M = digest(manifest);

  const lock = {
    schemaVersion: 1,
    kind: 'protos-d064-oci-lock',
    sourceRevision: X,
    d064ContentSha256: H,
    d064ManifestDigest: `sha256:${M}`,
  };

  return { lock, manifest, document, H, M };
}

function transport(f, overrides = {}) {
  const calls = [];

  const manifestUrl =
    `${service.REGISTRY_API}/manifests/sha256:${f.M}`;
  const blobUrl =
    `${service.REGISTRY_API}/blobs/sha256:${f.H}`;

  async function fetcher(url, options) {
    calls.push({ url, options });

    if (url === service.TOKEN_URL) {
      return overrides.token ??
        reply(200, JSON.stringify({ token: TOKEN }));
    }

    if (url === manifestUrl) {
      return overrides.manifest ??
        reply(200, f.manifest);
    }

    if (url === blobUrl) {
      return overrides.blob ??
        reply(307, '', { Location: CDN });
    }

    if (url === CDN) {
      return overrides.cdn ??
        reply(200, f.document);
    }

    throw new Error('Unexpected external request');
  }

  return {
    calls,
    fetcher,
    sha256,
  };
}

test('anonymous X/H/M fetch verifies content and never leaks the bearer to CDN', async () => {
  const f = fixture();
  const deps = transport(f);

  const loaded = await service.loadDocument(f.lock, deps);

  assert.deepEqual(loaded.lock, f.lock);
  assert.equal(loaded.document.provenance.revision, X);
  assert.equal(deps.calls.length, 4);

  assert.equal(deps.calls[0].url, service.TOKEN_URL);
  assert.equal(
    deps.calls[1].url,
    `${service.REGISTRY_API}/manifests/sha256:${f.M}`,
  );
  assert.equal(
    deps.calls[2].url,
    `${service.REGISTRY_API}/blobs/sha256:${f.H}`,
  );
  assert.equal(deps.calls[3].url, CDN);

  assert.equal(
    deps.calls[1].options.headers.Authorization,
    `Bearer ${TOKEN}`,
  );
  assert.equal(
    deps.calls[2].options.headers.Authorization,
    `Bearer ${TOKEN}`,
  );
  assert.equal(
    deps.calls[3].options.headers.Authorization,
    undefined,
  );

  for (const call of deps.calls) {
    assert.equal(call.options.method, 'GET');
    assert.ok(call.options.max_response_body_size > 0);
  }
});

test('the exact redirect host is required', () => {
  assert.equal(service.allowedBlobRedirect(CDN), true);
  assert.equal(
    service.allowedBlobRedirect(
      'https://pkg-containers.githubusercontent.com.evil.invalid/blob',
    ),
    false,
  );
  assert.equal(
    service.allowedBlobRedirect('https://evil.invalid/blob'),
    false,
  );
  assert.equal(
    service.allowedBlobRedirect('http://pkg-containers.githubusercontent.com/blob'),
    false,
  );
  assert.equal(
    service.allowedBlobRedirect(
      'https://pkg-containers.githubusercontent.com/blob#fragment',
    ),
    false,
  );
  assert.equal(
    service.allowedBlobRedirect(
      'https://pkg-containers.githubusercontent.com/blob\nInjected: yes',
    ),
    false,
  );
});

test('invalid lock fails before any network request', async () => {
  const f = fixture();
  const deps = transport(f);

  await assert.rejects(
    service.loadDocument({
      ...f.lock,
      d064ManifestDigest: 'sha256:invalid',
    }, deps),
  );

  assert.equal(deps.calls.length, 0);
});

test('invalid anonymous token never reaches the manifest', async () => {
  const f = fixture();
  const deps = transport(f, {
    token: reply(200, JSON.stringify({ token: 'bad\nvalue' })),
  });

  await assert.rejects(
    service.loadDocument(f.lock, deps),
    /token/i,
  );

  assert.equal(deps.calls.length, 1);
});

test('modified manifest bytes cannot pass M', async () => {
  const f = fixture();
  const deps = transport(f, {
    manifest: reply(
      200,
      Buffer.concat([f.manifest, Buffer.from(' ')]),
    ),
  });

  await assert.rejects(
    service.loadDocument(f.lock, deps),
  );

  assert.equal(deps.calls.length, 2);
});

test('unapproved blob redirect is never requested', async () => {
  const f = fixture();
  const deps = transport(f, {
    blob: reply(307, '', {
      Location: 'https://example.invalid/malicious',
    }),
  });

  await assert.rejects(
    service.loadDocument(f.lock, deps),
    /redirect/i,
  );

  assert.equal(deps.calls.length, 3);
});

test('a second redirect is never followed', async () => {
  const f = fixture();
  const deps = transport(f, {
    cdn: reply(307, '', {
      Location: 'https://pkg-containers.githubusercontent.com/other',
    }),
  });

  await assert.rejects(
    service.loadDocument(f.lock, deps),
  );

  assert.equal(deps.calls.length, 4);
});

test('modified D064 bytes cannot pass H', async () => {
  const f = fixture();
  const deps = transport(f, {
    cdn: reply(
      200,
      Buffer.concat([f.document, Buffer.from(' ')]),
    ),
  });

  await assert.rejects(
    service.loadDocument(f.lock, deps),
  );

  assert.equal(deps.calls.length, 4);
});

test('direct GHCR blob HTTP 200 is also supported', async () => {
  const f = fixture();
  const deps = transport(f, {
    blob: reply(200, f.document),
  });

  const loaded = await service.loadDocument(f.lock, deps);

  assert.equal(loaded.document.provenance.revision, X);
  assert.equal(deps.calls.length, 3);
});

test('declared oversized token response is rejected before reading', async () => {
  const f = fixture();

  const oversized = reply(
    200,
    JSON.stringify({ token: TOKEN }),
    { 'Content-Length': '9000' },
  );

  oversized.arrayBuffer = async () => {
    throw new Error('BODY_MUST_NOT_BE_READ');
  };

  const deps = transport(f, { token: oversized });

  await assert.rejects(
    service.loadDocument(f.lock, deps),
    /byte limit/i,
  );

  assert.equal(deps.calls.length, 1);
});

test('unauthorized GHCR blob does not trigger another credential path', async () => {
  const f = fixture();
  const deps = transport(f, {
    blob: reply(401),
  });

  await assert.rejects(
    service.loadDocument(f.lock, deps),
  );

  assert.equal(deps.calls.length, 3);
});

test('missing crypto or transport dependencies fail closed', async () => {
  const f = fixture();

  await assert.rejects(
    service.loadDocument(f.lock, {}),
    /dependencies/i,
  );
});
