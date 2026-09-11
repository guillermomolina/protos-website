import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const canonicalLinkFiles = [
  'src/content/docs/community/index.md',
  'src/content/docs/design/index.md',
];

const canonicalBlobPattern =
  /https:\/\/github\.com\/guillermomolina\/protos\/blob\/([0-9a-f]{40})\//g;

function desiredPrefix(revision) {
  return `https://github.com/guillermomolina/protos/blob/${revision}/`;
}

export function protosCanonicalLinksMatch({ root, lock }) {
  const expected = lock.revision;

  for (const relative of canonicalLinkFiles) {
    const path = join(root, relative);
    const content = readFileSync(path, 'utf8');
    for (const match of content.matchAll(canonicalBlobPattern)) {
      if (match[1] !== expected) return false;
    }
  }

  return true;
}

export function materializeProtosCanonicalLinks({ root, lock }) {
  const replacement = desiredPrefix(lock.revision);
  let changed = 0;

  for (const relative of canonicalLinkFiles) {
    const path = join(root, relative);
    const content = readFileSync(path, 'utf8');
    const next = content.replace(canonicalBlobPattern, replacement);

    if (next !== content) {
      writeFileSync(path, next, 'utf8');
      changed += 1;
    }
  }

  if (!protosCanonicalLinksMatch({ root, lock })) {
    throw new Error(
      `Manual canonical Protos links do not match locked revision ${lock.revision}`,
    );
  }

  console.log(
    `PROTOS_CANONICAL_LINKS_MATERIALIZED: revision=${lock.revision} files_changed=${changed}`,
  );
}
