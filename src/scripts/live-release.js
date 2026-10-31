// WEB011-C / WEB012: GitHub-backed, same-origin release presentation.
// NGINX owns upstream validation and shared caching.

const REPOSITORY = 'https://github.com/guillermomolina/protos';
const ENDPOINT = '/api/live/release';
const VERSION_PATTERN = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

function validatePayload(payload) {
  if (
    !payload ||
    payload.schemaVersion !== 1 ||
    (payload.state !== 'fresh' && payload.state !== 'stale')
  ) {
    return null;
  }

  const release = payload.release;

  if (
    !release ||
    release.prerelease !== true ||
    typeof release.version !== 'string' ||
    !VERSION_PATTERN.test(release.version)
  ) {
    return null;
  }

  const version = release.version;
  const tag = `v${version}`;
  const releaseUrl = `${REPOSITORY}/releases/tag/${tag}`;
  const base = `${REPOSITORY}/releases/download/${tag}/`;

  const nativeName = `protos-${version}-native-linux-x86_64.zip`;
  const portableName = `protos-${version}-posix-jvm.zip`;

  const expected = [
    [release.native, nativeName],
    [release.portable, portableName],
    [release.nativeChecksum, `${nativeName}.sha256`],
    [release.portableChecksum, `${portableName}.sha256`],
  ];

  if (
    release.tag !== tag ||
    release.url !== releaseUrl ||
    expected.some(([asset, name]) =>
      asset?.name !== name || asset?.url !== base + name
    )
  ) {
    return null;
  }

  return {
    releaseUrl,
    nativeUrl: release.native.url,
    portableUrl: release.portable.url,
    nativeChecksumUrl: release.nativeChecksum.url,
    portableChecksumUrl: release.portableChecksum.url,
  };
}

export function applyLiveRelease(documentRoot, payload) {
  const release = validatePayload(payload);
  if (!release) return false;

  const keys = [
    'version',
    'native',
    'portable',
    'notes',
    'native-archive',
    'native-checksum',
    'portable-archive',
    'portable-checksum',
  ];

  const elements = {};

  // Require the complete homepage before modifying any element.
  for (const key of keys) {
    const element = documentRoot.querySelector(
      `[data-live-release="${key}"]`,
    );
    if (!element) return false;
    elements[key] = element;
  }

  // The latest release is selected by the GitHub-backed server,
  // not by a pinned website version.
  // Never inject untrusted markup or remote shell commands.
  elements.version.textContent = 'Latest published prerelease';

  elements.native.href = release.nativeUrl;
  elements.native.textContent = 'Download Native';

  elements.portable.href = release.portableUrl;
  elements.portable.textContent = 'Download portable distribution';

  elements.notes.href = release.releaseUrl;

  elements['native-archive'].href = release.nativeUrl;
  elements['native-checksum'].href = release.nativeChecksumUrl;
  elements['portable-archive'].href = release.portableUrl;
  elements['portable-checksum'].href = release.portableChecksumUrl;

  return true;
}

export async function refreshLiveRelease(documentRoot, fetcher) {
  try {
    const response = await fetcher(ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) return false;

    return applyLiveRelease(
      documentRoot,
      await response.json(),
    );
  } catch {
    // Preserve versionless GitHub release links and shell commands.
    // Never present a stale pinned download as the latest release.
    return false;
  }
}
