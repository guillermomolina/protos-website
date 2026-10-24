
export const ROOTS = Object.freeze({"spec": ["spec"], "guide": ["docs", "guide"], "tutorials": ["protos", "tutorials"], "examples": ["protos", "examples"], "library": ["protos", "lib"]});

const REPO = 'guillermomolina/protos';
const SHA = /^[0-9a-f]{40}$/;
const PART = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;

function safePath(path) {
  if (typeof path !== 'string' || path.length > 240) return false;
  const parts = path.split('/');
  return parts.length <= 12 && parts.every(p => PART.test(p));
}

export function relativePath(family, path) {
  const root = ROOTS[family];
  if (
    !Array.isArray(root) ||
    root.length === 0 ||
    !root.every(segment =>
      typeof segment === 'string' && PART.test(segment)
    )
  ) return null;
  const prefix = root.join('/') + '/';
  if (typeof path !== 'string' || !path.startsWith(prefix)) return null;
  const relative = path.slice(prefix.length);
  return safePath(relative) ? relative : null;
}

export function admitCatalog(payload) {
  const s = payload?.snapshot;
  const c = payload?.catalog;
  if (
    payload?.schemaVersion !== 1 ||
    payload?.kind !== 'documentation-catalog' ||
    !['fresh', 'stale'].includes(payload.state) ||
    !s || !c ||
    !SHA.test(s.revision) || !SHA.test(s.treeSha) ||
    c.schemaVersion !== 1 ||
    c.kind !== 'canonical-document-catalog' ||
    c.repository !== REPO ||
    c.revision !== s.revision ||
    c.treeSha !== s.treeSha ||
    !Array.isArray(c.entries) ||
    c.entries.length < 1 || c.entries.length > 512
  ) return null;

  const seen = new Set();
  const entries = [];

  for (const e of c.entries) {
    const relative = e && relativePath(e.family, e.path);
    if (
      !e || e.type !== 'blob' || relative === null ||
      !SHA.test(e.blobSha) ||
      !Number.isInteger(e.size) ||
      e.size < 0 || e.size > 131072 ||
      seen.has(e.path)
    ) return null;

    seen.add(e.path);
    entries.push({
      family: e.family,
      path: e.path,
      relative,
      blobSha: e.blobSha,
      size: e.size
    });
  }

  return {
    revision: s.revision,
    treeSha: s.treeSha,
    state: payload.state,
    entries
  };
}

export function admitDocument(payload, catalog, entry) {
  const s = payload?.snapshot;
  const d = payload?.document;

  if (
    payload?.schemaVersion !== 1 ||
    payload?.kind !== 'documentation-document' ||
    !['fresh', 'stale'].includes(payload.state) ||
    !s || !d || !catalog || !entry ||
    s.revision !== catalog.revision ||
    s.treeSha !== catalog.treeSha ||
    d.schemaVersion !== 1 ||
    d.kind !== 'canonical-document' ||
    d.repository !== REPO ||
    d.revision !== catalog.revision ||
    d.treeSha !== catalog.treeSha ||
    d.family !== entry.family ||
    d.path !== entry.path ||
    typeof d.content !== 'string' ||
    d.content.length > 131072 ||
    typeof d.contentKind !== 'string' ||
    d.contentKind.length > 32
  ) return null;

  return {
    kind: d.contentKind,
    text: d.content,
    state: payload.state
  };
}

export function sourceHref(catalog, entry) {
  if (
    !catalog || !entry ||
    !SHA.test(catalog.revision) ||
    relativePath(entry.family, entry.path) === null
  ) return '#';

  const path = entry.path.split('/')
    .map(encodeURIComponent).join('/');

  return `https://github.com/${REPO}/blob/${catalog.revision}/${path}`;
}
