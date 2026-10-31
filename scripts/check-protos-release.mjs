import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import githubRelease from '../server/github-release.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(
  readFileSync(join(root, 'protos-release.lock.json'), 'utf8'),
);

if (
  config.schemaVersion !== 2 ||
  config.repository !== 'guillermomolina/protos' ||
  config.channel !== 'latest-published-prerelease'
) {
  throw new Error('Invalid dynamic Protos release configuration');
}

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'protos-website-release-check',
};

if (process.env.GITHUB_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

const response = await fetch(
  `https://api.github.com/repos/${config.repository}/releases?per_page=10`,
  { headers },
);

if (!response.ok) {
  throw new Error(`GitHub Releases HTTP ${response.status}`);
}

const releases = await response.json();
const current = githubRelease.normalizeLatestRelease(releases);

console.log(
  `PROTOS_RELEASE_CHECK: PASS latest=${current.tag} ` +
  `native=${current.native.name} portable=${current.portable.name}`,
);
