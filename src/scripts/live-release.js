// WEB011-C: same-origin presentation adapter.
// GitHub requests, validation and shared caching belong to NGINX.

const REPOSITORY = 'https://github.com/guillermomolina/protos';
const ENDPOINT = '/api/live/release';
const VERSION_PATTERN = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);

  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] > b[index] ? 1 : -1;
    }
  }

  return 0;
}

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
  const downloadBase = `${REPOSITORY}/releases/download/${tag}/`;

  const nativeName =
    `protos-${version}-native-linux-x86_64.zip`;

  const portableName =
    `protos-${version}-posix-jvm.zip`;

  if (
    release.tag !== tag ||
    release.url !== releaseUrl ||
    release.native?.name !== nativeName ||
    release.native?.url !== downloadBase + nativeName ||
    release.portable?.name !== portableName ||
    release.portable?.url !== downloadBase + portableName
  ) {
    return null;
  }

  return {
    version,
    releaseUrl,
    nativeUrl: release.native.url,
    portableUrl: release.portable.url,
    portableName,
  };
}

export function applyLiveRelease(documentRoot, payload) {
  const release = validatePayload(payload);

  if (!release) return false;

  const selectors = {
    version: '[data-live-release="version"]',
    native: '[data-live-release="native"]',
    portable: '[data-live-release="portable"]',
    notes: '[data-live-release="notes"]',
  };

  const elements = {};

  for (const [name, selector] of Object.entries(selectors)) {
    elements[name] = documentRoot.querySelector(selector);
    if (!elements[name]) return false;
  }

  const current = elements.version.getAttribute(
    'data-release-current',
  );

  // Never replace an already-advertised release with an older one.
  if (
    current &&
    VERSION_PATTERN.test(current) &&
    compareVersions(release.version, current) < 0
  ) {
    return false;
  }

  // All values were validated before any DOM modification.
  // Never render upstream data using innerHTML.
  elements.version.textContent = `Pre-release: ${release.version}`;

  elements.native.href = release.nativeUrl;
  elements.native.textContent =
    `Download ${release.version} for Linux x86_64`;

  elements.portable.href = release.portableUrl;
  elements.portable.textContent = release.portableName;

  elements.notes.href = release.releaseUrl;

  return true;
}

export async function refreshLiveRelease(documentRoot, fetcher) {
  try {
    const response = await fetcher(ENDPOINT, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) return false;

    const payload = await response.json();

    return applyLiveRelease(documentRoot, payload);
  } catch {
    // Retain Astro's build-time fallback when NGINX/GitHub is unavailable.
    return false;
  }
}
