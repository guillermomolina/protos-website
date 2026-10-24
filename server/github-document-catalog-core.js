import revisionCore from './github-document-revision-core.js';
import sourceCore from './github-document-source-core.js';

// WEB011-D4B: read only Git tree objects chained to an exact commit tree.
const REPOSITORY = 'guillermomolina/protos';
const API = `https://api.github.com/repos/${REPOSITORY}/git/trees/`;
const SHA = /^[0-9a-f]{40}$/;

const ROOTS = {
  spec: ['spec'],
  guide: ['docs', 'guide'],
  tutorials: ['protos', 'tutorials'],
  examples: ['protos', 'examples'],
  library: ['protos', 'lib'],
};

const MAX_TREE_ITEMS = 8192;
const MAX_CATALOG_ENTRIES = 512;
const MAX_UPSTREAM_CHARS = 2 * 1024 * 1024;

function treeUrl(sha, recursive) {
  if (typeof sha !== 'string' || !SHA.test(sha)) {
    throw new Error('Invalid Git tree identity');
  }

  return API + sha + (recursive ? '?recursive=1' : '');
}

function admitTree(payload, expectedSha) {
  treeUrl(expectedSha, false);

  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    payload.sha !== expectedSha ||
    payload.truncated !== false ||
    !Array.isArray(payload.tree) ||
    payload.tree.length > MAX_TREE_ITEMS
  ) {
    throw new Error('Truncated or inconsistent Git tree');
  }

  return payload.tree;
}

function childTree(entries, name) {
  let selected = null;

  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];

    if (item && item.path === name) {
      if (
        selected !== null ||
        item.type !== 'tree' ||
        item.mode !== '040000' ||
        typeof item.sha !== 'string' ||
        !SHA.test(item.sha)
      ) {
        throw new Error('Invalid Git subtree link');
      }

      selected = item.sha;
    }
  }

  if (selected === null) {
    throw new Error('Missing Git subtree link');
  }

  return selected;
}

function normalizeCatalog(snapshot, families) {
  revisionCore.requireSnapshot(snapshot);

  const entries = [];
  const names = Object.keys(ROOTS);

  for (let i = 0; i < names.length; i++) {
    const family = names[i];
    const source = families[family];

    if (!source || !Array.isArray(source.entries)) {
      throw new Error('Missing verified family tree');
    }

    const seen = Object.create(null);

    for (let j = 0; j < source.entries.length; j++) {
      const item = source.entries[j];

      if (
        !item ||
        item.type !== 'blob' ||
        (item.mode !== '100644' && item.mode !== '100755')
      ) {
        continue;
      }

      let location;

      try {
        location = revisionCore.canonicalDocument(
          snapshot,
          family,
          item.path,
        );
      } catch (ignoredError) {
        continue;
      }

      if (seen[location.path]) {
        throw new Error('Duplicate document in Git tree');
      }

      seen[location.path] = true;

      if (
        typeof item.sha !== 'string' ||
        !SHA.test(item.sha) ||
        !Number.isInteger(item.size) ||
        item.size < 0
      ) {
        throw new Error('Invalid canonical Git blob identity');
      }

      if (item.size > sourceCore.MAX_DOCUMENT_BYTES) {
        continue;
      }

      entries.push({
        family,
        path: location.path,
        type: 'blob',
        blobSha: item.sha,
        size: item.size,
      });

      if (entries.length > MAX_CATALOG_ENTRIES) {
        throw new Error('Canonical documentation catalog is over limit');
      }
    }
  }

  entries.sort(function(a, b) {
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });

  return {
    schemaVersion: 1,
    kind: 'canonical-document-catalog',
    repository: REPOSITORY,
    revision: snapshot.revision,
    treeSha: snapshot.treeSha,
    entries,
  };
}

export default {
  ROOTS,
  MAX_TREE_ITEMS,
  MAX_UPSTREAM_CHARS,
  treeUrl,
  admitTree,
  childTree,
  normalizeCatalog,
};
