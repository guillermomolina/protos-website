import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyLiveRelease,
  refreshLiveRelease,
} from '../src/scripts/live-release.js';

function fixture(version = '0.3.398', state = 'fresh') {
  const tag = `v${version}`;
  const repo = 'https://github.com/guillermomolina/protos';
  const base = `${repo}/releases/download/${tag}/`;
  const native = `protos-${version}-native-linux-x86_64.zip`;
  const portable = `protos-${version}-posix-jvm.zip`;

  return {
    schemaVersion: 1,
    state,
    release: {
      version,
      tag,
      prerelease: true,
      url: `${repo}/releases/tag/${tag}`,
      native: { name: native, url: base + native },
      portable: { name: portable, url: base + portable },
    },
  };
}

function page(current = '0.3.398') {
  const nodes = new Map();

  for (const key of ['version', 'native', 'portable', 'notes']) {
    nodes.set(`[data-live-release="${key}"]`, {
      textContent: 'original',
      href: 'https://example.invalid/original',
      getAttribute(name) {
        if (
          key === 'version' &&
          name === 'data-release-current'
        ) {
          return current;
        }

        return null;
      },
    });
  }

  return {
    nodes,
    querySelector(selector) {
      return nodes.get(selector) ?? null;
    },
    element(key) {
      return nodes.get(`[data-live-release="${key}"]`);
    },
  };
}

test('homepage has the four explicit release anchors', () => {
  const html = readFileSync('src/pages/index.astro', 'utf8');

  for (const key of ['version', 'native', 'portable', 'notes']) {
    const marker = `data-live-release="${key}"`;
    assert.equal(html.split(marker).length - 1, 1);
  }

  assert.match(html, /data-release-current=\{releaseVersion\}/);
  assert.match(html, /refreshLiveRelease\(document, fetch\)/);
});

test('renders a validated live release', () => {
  const document = page();

  assert.equal(applyLiveRelease(document, fixture()), true);

  assert.equal(
    document.element('version').textContent,
    'Pre-release: 0.3.398',
  );

  assert.equal(
    document.element('native').textContent,
    'Download 0.3.398 for Linux x86_64',
  );

  assert.equal(
    document.element('portable').textContent,
    'protos-0.3.398-posix-jvm.zip',
  );

  assert.equal(
    document.element('notes').href,
    'https://github.com/guillermomolina/protos/releases/tag/v0.3.398',
  );
});

test('new releases appear without rebuilding the homepage', () => {
  const document = page();

  assert.equal(
    applyLiveRelease(document, fixture('0.3.399')),
    true,
  );

  assert.match(
    document.element('native').href,
    /v0\.3\.399\/protos-0\.3\.399-native/,
  );

  assert.equal(
    document.element('version').textContent,
    'Pre-release: 0.3.399',
  );
});

test('never downgrades the build-time release', () => {
  const document = page('0.3.398');

  assert.equal(
    applyLiveRelease(document, fixture('0.3.312')),
    false,
  );

  assert.equal(
    document.element('version').textContent,
    'original',
  );
});

test('rejects substituted GitHub download URLs', () => {
  const payload = fixture();

  payload.release.native.url =
    'https://example.invalid/malicious.zip';

  const document = page();

  assert.equal(applyLiveRelease(document, payload), false);
  assert.equal(document.element('native').textContent, 'original');
});

test('rejects inconsistent release identities', () => {
  const payload = fixture();
  payload.release.tag = 'v0.3.312';

  assert.equal(applyLiveRelease(page(), payload), false);
});

test('accepts valid stale data', () => {
  const document = page();

  assert.equal(
    applyLiveRelease(document, fixture('0.3.399', 'stale')),
    true,
  );

  assert.equal(
    document.element('version').textContent,
    'Pre-release: 0.3.399',
  );
});

test('does not partially modify a page with a missing anchor', () => {
  const document = page();

  document.nodes.delete('[data-live-release="notes"]');

  assert.equal(applyLiveRelease(document, fixture()), false);

  assert.equal(
    document.element('version').textContent,
    'original',
  );
});

test('fetches only the same-origin NGINX endpoint', async () => {
  const document = page();
  let calls = 0;

  const applied = await refreshLiveRelease(
    document,
    async (url, options) => {
      calls += 1;

      assert.equal(url, '/api/live/release');
      assert.equal(options.method, 'GET');
      assert.equal(options.cache, 'no-store');

      return {
        ok: true,
        json: async () => fixture(),
      };
    },
  );

  assert.equal(applied, true);
  assert.equal(calls, 1);
});

test('preserves the static fallback on HTTP failure', async () => {
  const document = page();

  const applied = await refreshLiveRelease(
    document,
    async () => ({ ok: false, status: 503 }),
  );

  assert.equal(applied, false);

  assert.equal(
    document.element('version').textContent,
    'original',
  );
});

test('preserves the static fallback on network failure', async () => {
  const document = page();

  const applied = await refreshLiveRelease(
    document,
    async () => {
      throw new Error('network unavailable');
    },
  );

  assert.equal(applied, false);

  assert.equal(
    document.element('version').textContent,
    'original',
  );
});
