// WEB011-A: read-only GitHub Releases projection for NGINX njs.
// No Node.js runtime dependency in production.

const RELEASES_URL =
  'https://api.github.com/repos/guillermomolina/protos/releases?per_page=10';

const DOWNLOAD_BASE =
  'https://github.com/guillermomolina/protos/releases/download/';

const FRESH_TTL_MS = 15 * 60 * 1000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_LEASE_MS = 10 * 1000;
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;

const FRESH_KEY = 'release:fresh';
const STALE_KEY = 'release:stale';
const LEASE_KEY = 'release:fetching';
const BACKOFF_KEY = 'release:retry-after-failure';

function requiredAsset(release, name) {
  const expectedUrl =
    `${DOWNLOAD_BASE}${release.tag_name}/${name}`;

  const matches = release.assets.filter(
    (asset) => asset.name === name,
  );

  if (matches.length !== 1) {
    throw new Error(`Missing or duplicate release asset: ${name}`);
  }

  const asset = matches[0];

  if (
    asset.state !== 'uploaded' ||
    asset.browser_download_url !== expectedUrl ||
    !/^sha256:[0-9a-f]{64}$/.test((typeof asset.digest === 'string' ? asset.digest : ''))
  ) {
    throw new Error(`Invalid release asset: ${name}`);
  }

  return {
    name: name,
    url: expectedUrl,
    sha256: asset.digest.slice('sha256:'.length),
  };
}

function normalizeLatestRelease(releases) {
  if (!Array.isArray(releases) || releases.length > 10) {
    throw new Error('Unexpected GitHub releases response');
  }

  const published = releases.filter(
    (item) =>
      item !== null &&
      item.draft === false &&
      item.prerelease === true,
  );

  if (published.length === 0) {
    throw new Error('No published prerelease');
  }

  for (let index = 0; index < published.length; index += 1) {
    const item = published[index];
    if (
      typeof item.published_at !== 'string' ||
      !Number.isFinite(Date.parse(item.published_at))
    ) {
      throw new Error('Invalid release publication date');
    }
  }

  published.sort(
    (left, right) =>
      Date.parse(right.published_at) -
      Date.parse(left.published_at),
  );

  const release = published[0];
  const tag = release.tag_name;

  if (
    typeof tag !== 'string' ||
    !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag) ||
    release.html_url !==
      `https://github.com/guillermomolina/protos/releases/tag/${tag}` ||
    !Array.isArray(release.assets)
  ) {
    throw new Error('Invalid release identity');
  }

  const version = tag.slice(1);
  const nativeName =
    `protos-${version}-native-linux-x86_64.zip`;
  const portableName =
    `protos-${version}-posix-jvm.zip`;

  return {
    version: version,
    tag: tag,
    title: `Protos ${version}`,
    url: release.html_url,
    publishedAt: release.published_at,
    prerelease: true,
    native: requiredAsset(release, nativeName),
    portable: requiredAsset(release, portableName),
    nativeChecksum: requiredAsset(
      release,
      `${nativeName}.sha256`,
    ),
    portableChecksum: requiredAsset(
      release,
      `${portableName}.sha256`,
    ),
    manifest: requiredAsset(release, 'RELEASE_MANIFEST.txt'),
  };
}

function readCached(cache, key) {
  try {
    const raw = cache.get(key);
    if (typeof raw !== 'string') return null;

    const release = JSON.parse(raw);

    if (
      !release ||
      typeof release.version !== 'string' ||
      typeof release.tag !== 'string' ||
      release.tag !== `v${release.version}` ||
      !release.native ||
      !release.portable
    ) {
      return null;
    }

    return release;
  } catch (error) {
    return null;
  }
}

function respond(request, status, state, release) {
  if (release === undefined) release = null;
  request.headersOut['Content-Type'] =
    'application/json; charset=utf-8';
  request.headersOut['Cache-Control'] = 'no-store';
  request.headersOut['X-Protos-Content-State'] = state;

  request.return(
    status,
    JSON.stringify({
      schemaVersion: 1,
      state,
      release,
    }),
  );
}

async function serveRelease(request, dependencies) {
  const cache = dependencies.cache;
  const fetcher = dependencies.fetcher;
  // No shared cache means no upstream request, avoiding
  // accidental unbounded traffic from a misconfigured server.
  if (!cache) {
    respond(request, 503, 'unavailable');
    return;
  }

  const fresh = readCached(cache, FRESH_KEY);
  if (fresh) {
    request.headersOut['X-Protos-Cache'] = 'HIT';
    respond(request, 200, 'fresh', fresh);
    return;
  }

  const stale = readCached(cache, STALE_KEY);

  // A failed upstream request must not produce a request storm.
  // The backoff is shared by all NGINX workers.
  try {
    if (cache.get(BACKOFF_KEY) === '1') {
      respond(
        request,
        stale ? 200 : 503,
        stale ? 'stale' : 'unavailable',
        stale,
      );
      return;
    }
  } catch (error) {
    respond(
      request,
      stale ? 200 : 503,
      stale ? 'stale' : 'unavailable',
      stale,
    );
    return;
  }

  let acquired;
  try {
    acquired = cache.add(
      LEASE_KEY,
      '1',
      FETCH_LEASE_MS,
    );
  } catch (error) {
    respond(
      request,
      stale ? 200 : 503,
      stale ? 'stale' : 'unavailable',
      stale,
    );
    return;
  }

  if (!acquired) {
    respond(
      request,
      stale ? 200 : 503,
      stale ? 'stale' : 'unavailable',
      stale,
    );
    return;
  }

  try {
    const response = await fetcher(RELEASES_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'protos-website-dynamic-content',
      },
      max_response_body_size: 524288,
    });

    if (response.status !== 200) {
      throw new Error(`GitHub returned HTTP ${response.status}`);
    }

    const raw = await response.text();
    if (raw.length > 524288) {
      throw new Error('GitHub response exceeds size limit');
    }

    const release = normalizeLatestRelease(JSON.parse(raw));
    const serialized = JSON.stringify(release);

    cache.set(FRESH_KEY, serialized, FRESH_TTL_MS);
    cache.set(STALE_KEY, serialized, STALE_TTL_MS);

    try {
      cache.delete(BACKOFF_KEY);
    } catch (error) {
      // A cache cleanup failure must not invalidate a good release.
    }

    request.headersOut['X-Protos-Cache'] = 'MISS';
    respond(request, 200, 'fresh', release);
  } catch (error) {
    try {
      cache.set(BACKOFF_KEY, '1', FAILURE_BACKOFF_MS);
    } catch (error) {
      // Continue with the last known good response if available.
    }

    respond(
      request,
      stale ? 200 : 503,
      stale ? 'stale' : 'unavailable',
      stale,
    );
  } finally {
    try {
      cache.delete(LEASE_KEY);
    } catch (error) {
      // Cache failures cannot make the static website unavailable.
    }
  }
}

// NGINX will invoke this entry point in WEB011-B.
async function release(request) {
  return serveRelease(request, {
    cache: ngx.shared.protos_content,
    fetcher: (url, options) => ngx.fetch(url, options),
  });
}

export default {
  normalizeLatestRelease: normalizeLatestRelease,
  serveRelease: serveRelease,
  release: release,
};
