import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyLiveRelease,
  refreshLiveRelease,
} from '../src/scripts/live-release.js';

import {
  nativeFirstRun,
  portableFirstRun,
  wireOnboardingCopy,
} from '../src/scripts/release-onboarding.js';

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
      nativeChecksum: {
        name: `${native}.sha256`,
        url: `${base}${native}.sha256`,
      },
      portableChecksum: {
        name: `${portable}.sha256`,
        url: `${base}${portable}.sha256`,
      },
    },
  };
}

const releaseKeys = [
  'version', 'native', 'portable', 'notes',
  'native-archive', 'native-checksum',
  'portable-archive', 'portable-checksum',
];

function page() {
  const nodes = new Map();

  for (const key of releaseKeys) {
    nodes.set(`[data-live-release="${key}"]`, {
      textContent: 'original',
      href: 'https://github.com/guillermomolina/protos/releases',
    });
  }

  nodes.set('[data-first-run="native"]', {
    textContent: nativeFirstRun,
  });
  nodes.set('[data-first-run="portable"]', {
    textContent: portableFirstRun,
  });

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

test('homepage exposes all release links and first-run commands', () => {
  const html = readFileSync('src/pages/index.astro', 'utf8');

  for (const key of releaseKeys) {
    assert.equal(
      html.split(`data-live-release="${key}"`).length - 1,
      1,
    );
  }

  assert.match(html, /Try Protos/);
  assert.match(html, /data-first-run="native"/);
  assert.match(html, /data-first-run="portable"/);
  assert.match(html, /data-copy-onboarding="native"/);
  assert.match(html, /data-copy-onboarding="portable"/);
  assert.match(html, /refreshLiveRelease\(document, fetch\)/);
  assert.match(html, /wireOnboardingCopy\(document\)/);

  assert.doesNotMatch(html, /protosRelease|releaseVersion/);
  assert.doesNotMatch(html, /v0\.3\.\d+/);
});

test('versionless commands discover the current GitHub prerelease', () => {
  for (const commands of [nativeFirstRun, portableFirstRun]) {
    assert.match(commands, /api\.github\.com\/repos\/guillermomolina\/protos\/releases/);
    assert.match(commands, /curl -fsSL/);
    assert.match(commands, /prerelease/);
    assert.match(commands, /sha256sum -c/);
    assert.match(commands, /unzip/);
    assert.match(commands, /bin\/protos --version/);
    assert.match(commands, /Hello, Protos!/);
    assert.doesNotMatch(commands, /v0\.3\.\d+/);
  }

  assert.match(nativeFirstRun, /native-linux-x86_64/);
  assert.match(portableFirstRun, /posix-jvm/);
  assert.match(portableFirstRun, /JAVA_HOME/);
});

test('valid GitHub release updates all four asset links', () => {
  const document = page();

  assert.equal(applyLiveRelease(document, fixture()), true);

  assert.equal(
    document.element('version').textContent,
    'Latest published prerelease',
  );
  assert.equal(
    document.element('native').textContent,
    'Download Native',
  );
  assert.equal(
    document.element('portable').textContent,
    'Download portable distribution',
  );

  assert.match(
    document.element('native-archive').href,
    /v0\.3\.398\/protos-0\.3\.398-native/,
  );
  assert.match(
    document.element('native-checksum').href,
    /protos-0\.3\.398-native-linux-x86_64\.zip\.sha256$/,
  );
  assert.match(
    document.element('portable-archive').href,
    /v0\.3\.398\/protos-0\.3\.398-posix-jvm/,
  );
  assert.match(
    document.element('portable-checksum').href,
    /protos-0\.3\.398-posix-jvm\.zip\.sha256$/,
  );

  assert.match(document.element('notes').href, /releases\/tag\/v0\.3\.398/);
});

test('new releases update links without rebuilding or changing shell commands', () => {
  const document = page();

  assert.equal(applyLiveRelease(document, fixture('0.3.399')), true);

  assert.match(document.element('native').href, /v0\.3\.399/);
  assert.match(document.element('portable').href, /v0\.3\.399/);
  assert.match(document.element('native-checksum').href, /v0\.3\.399/);
  assert.match(document.element('portable-checksum').href, /v0\.3\.399/);

  assert.equal(
    document.querySelector('[data-first-run="native"]').textContent,
    nativeFirstRun,
  );
});

test('rejects untrusted GitHub asset URL substitution', () => {
  const payload = fixture();
  payload.release.native.url = 'https://example.invalid/untrusted.zip';

  const document = page();
  assert.equal(applyLiveRelease(document, payload), false);
  assert.equal(document.element('version').textContent, 'original');
});

test('rejects untrusted checksum URL substitution', () => {
  const payload = fixture();
  payload.release.nativeChecksum.url =
    'https://example.invalid/forged.sha256';

  const document = page();
  assert.equal(applyLiveRelease(document, payload), false);
  assert.equal(
    document.element('native-checksum').href,
    'https://github.com/guillermomolina/protos/releases',
  );
});

test('rejects inconsistent tag and assets', () => {
  const payload = fixture();
  payload.release.tag = 'v0.3.312';

  assert.equal(applyLiveRelease(page(), payload), false);

  const missing = fixture();
  delete missing.release.portableChecksum;

  assert.equal(applyLiveRelease(page(), missing), false);
});

test('accepts a validated stale cache response', () => {
  const document = page();

  assert.equal(
    applyLiveRelease(document, fixture('0.3.399', 'stale')),
    true,
  );
  assert.match(document.element('native').href, /v0\.3\.399/);
});

test('missing DOM anchor prevents every partial update', () => {
  const document = page();
  document.nodes.delete('[data-live-release="portable-checksum"]');

  assert.equal(applyLiveRelease(document, fixture()), false);
  assert.equal(document.element('version').textContent, 'original');
  assert.equal(
    document.element('native').href,
    'https://github.com/guillermomolina/protos/releases',
  );
});

test('fetches only the existing same-origin endpoint', async () => {
  const document = page();
  let calls = 0;

  const applied = await refreshLiveRelease(
    document,
    async (url, options) => {
      calls++;
      assert.equal(url, '/api/live/release');
      assert.equal(options.method, 'GET');
      assert.equal(options.cache, 'no-store');

      return { ok: true, json: async () => fixture() };
    },
  );

  assert.equal(applied, true);
  assert.equal(calls, 1);
});

test('HTTP failure retains versionless release links', async () => {
  const document = page();

  assert.equal(
    await refreshLiveRelease(document, async () => ({ ok: false })),
    false,
  );

  assert.equal(
    document.element('native').href,
    'https://github.com/guillermomolina/protos/releases',
  );
  assert.equal(
    document.querySelector('[data-first-run="native"]').textContent,
    nativeFirstRun,
  );
});

test('network failure retains versionless shell commands', async () => {
  const document = page();

  assert.equal(
    await refreshLiveRelease(document, async () => {
      throw new Error('Network unavailable');
    }),
    false,
  );

  assert.equal(
    document.querySelector('[data-first-run="portable"]').textContent,
    portableFirstRun,
  );
});

test('copy action reads the current Native commands', async () => {
  const document = page();
  let handler;
  let copied = '';
  const status = { textContent: '' };

  const button = {
    getAttribute: () => 'native',
    parentElement: { querySelector: () => status },
    addEventListener: (event, callback) => {
      assert.equal(event, 'click');
      handler = callback;
    },
  };

  document.querySelectorAll = () => [button];

  wireOnboardingCopy(document, {
    writeText: async (text) => { copied = text; },
  });

  await handler();
  assert.equal(copied, nativeFirstRun);
  assert.equal(status.textContent, 'Copied');
});
