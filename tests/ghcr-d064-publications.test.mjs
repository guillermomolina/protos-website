import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import core from '../server/ghcr-d064-publications-core.js';
import service from '../server/ghcr-d064-publications-service.js';

const registry = JSON.parse(
  readFileSync(
    new URL('../protos-d064-publications.json', import.meta.url),
    'utf8',
  ),
);

function copy() {
  return JSON.parse(JSON.stringify(registry));
}

function reply(status, data = '', headers = {}) {
  const bytes = Buffer.from(data);
  const values = Object.create(null);

  for (const [name, value] of Object.entries(headers)) {
    values[name.toLowerCase()] = value;
  }

  return {
    status,
    headers: {
      get(name) {
        return values[name.toLowerCase()] ?? null;
      },
    },
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer;
    },
  };
}

test('the checked-in registry admits the real published X/H/M', () => {
  const admitted = core.admitIndex(registry);
  const lock = core.activeLock(admitted);

  assert.equal(admitted.publications.length, 1);
  assert.equal(lock.sourceRevision, registry.activeRevision);
  assert.equal(lock.d064ContentSha256,
    '236597164f28f3d735ea329a9b20fbe348f7628347cc1e3e498d1650a12e80e9');
  assert.equal(lock.d064ManifestDigest,
    'sha256:19b27bb39e2321333ec570631a821e8d43c2d4c4c98c6cfd9c8150879418bc4e');
});

test('the active publication must be explicitly admitted', () => {
  const data = copy();
  data.activeRevision = 'f'.repeat(40);

  assert.throws(() => core.admitIndex(data));
});

test('duplicate source revisions are rejected', () => {
  const data = copy();
  data.publications.push({ ...data.publications[0] });

  assert.throws(() => core.admitIndex(data));
});

test('two revisions cannot claim the same content digest', () => {
  const data = copy();

  data.publications.push({
    ...data.publications[0],
    sourceRevision: 'b'.repeat(40),
    d064ManifestDigest: `sha256:${'c'.repeat(64)}`,
  });

  assert.throws(() => core.admitIndex(data));
});

test('two revisions cannot claim the same OCI manifest digest', () => {
  const data = copy();

  data.publications.push({
    ...data.publications[0],
    sourceRevision: 'b'.repeat(40),
    d064ContentSha256: 'c'.repeat(64),
  });

  assert.throws(() => core.admitIndex(data));
});

test('mutable discovery aliases cannot enter the authoritative lock', () => {
  const data = copy();
  data.publications[0].tag =
    `rev-${data.publications[0].sourceRevision}`;

  assert.throws(() => core.admitIndex(data));
});

test('unknown registry fields are rejected', () => {
  const data = copy();
  data.sourceUrl = 'https://example.invalid/substitute';

  assert.throws(() => core.admitIndex(data));
});

test('publication count is bounded', () => {
  const data = copy();

  while (data.publications.length <= core.MAX_PUBLICATIONS) {
    data.publications.push({
      ...data.publications[0],
    });
  }

  assert.throws(() => core.admitIndex(data));
});

test('GitHub discovery fetches only the fixed repository URL', async () => {
  const calls = [];

  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return reply(200, JSON.stringify(registry));
  };

  const admitted = await service.loadIndex(fetcher);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, core.INDEX_URL);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(
    calls[0].options.max_response_body_size,
    core.MAX_INDEX_BYTES,
  );
  assert.equal(
    core.activeLock(admitted).sourceRevision,
    registry.activeRevision,
  );
});

test('non-200 GitHub response fails closed', async () => {
  await assert.rejects(
    service.loadIndex(async () => reply(404)),
    /unavailable/i,
  );
});

test('oversized declared response is rejected before reading', async () => {
  const response = reply(
    200,
    JSON.stringify(registry),
    { 'Content-Length': String(core.MAX_INDEX_BYTES + 1) },
  );

  response.arrayBuffer = async () => {
    throw new Error('BODY_MUST_NOT_BE_READ');
  };

  await assert.rejects(
    service.loadIndex(async () => response),
    /byte limit/i,
  );
});

test('oversized actual response is rejected', async () => {
  const oversized = 'x'.repeat(core.MAX_INDEX_BYTES + 1);

  await assert.rejects(
    service.loadIndex(async () => reply(200, oversized)),
    /byte limit/i,
  );
});

test('malformed JSON cannot become a publication registry', async () => {
  await assert.rejects(
    service.loadIndex(async () => reply(200, '{invalid')),
    /JSON/i,
  );
});

test('missing GitHub transport fails closed', async () => {
  await assert.rejects(
    service.loadIndex(null),
    /unavailable/i,
  );
});
