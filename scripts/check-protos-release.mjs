import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const lockPath = join(root, 'protos-release.lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

if (lock.schemaVersion !== 1) {
  throw new Error(`Unsupported release lock schema: ${lock.schemaVersion}`);
}

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'protos-website-release-check',
};

const token = process.env.GITHUB_TOKEN;
if (token) {
  headers.Authorization = `Bearer ${token}`;
}

const response = await fetch(
  `https://api.github.com/repos/${lock.repository}/releases?per_page=20`,
  { headers },
);

if (!response.ok) {
  throw new Error(
    `GitHub releases query failed: HTTP ${response.status} ${response.statusText}`,
  );
}

const releases = await response.json();

const current = releases.find(
  (release) => !release.draft && release.prerelease === lock.prerelease,
);

if (!current) {
  throw new Error(
    `No published prerelease matching prerelease=${lock.prerelease} was found`,
  );
}

if (current.tag_name !== lock.tag) {
  throw new Error(
    `Stale Protos release lock: locked=${lock.tag} current=${current.tag_name}`,
  );
}

if (current.html_url !== lock.releaseUrl) {
  throw new Error(
    `Release URL mismatch: locked=${lock.releaseUrl} current=${current.html_url}`,
  );
}

// `nativeAsset` is optional so older single-asset locks remain valid.
const lockedAssets = [
  ['Portable', lock.portableAsset],
  ...(lock.nativeAsset ? [['Native', lock.nativeAsset]] : []),
];

for (const [kind, name] of lockedAssets) {
  if (!current.assets.some((candidate) => candidate.name === name)) {
    throw new Error(`${kind} release asset not found: ${name}`);
  }
}

console.log(
  `PROTOS_RELEASE_CHECK: PASS tag=${lock.tag} ` +
    lockedAssets.map(([, name]) => `asset=${name}`).join(' '),
);
