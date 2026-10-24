import revisionCore from './github-document-revision-core.js';
import catalogCore from './github-document-catalog-core.js';

// WEB011-D4B: exact-SHA Git trees only.
// No user-controlled paths, refs or URLs.

async function createCatalog(snapshot, fetcher) {
  revisionCore.requireSnapshot(snapshot);

  if (typeof fetcher !== 'function') {
    throw new Error('Git tree transport unavailable');
  }

  async function fetchTree(sha, recursive) {
    const endpoint = catalogCore.treeUrl(sha, recursive);

    const response = await fetcher(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'protos-website-live-docs',
      },
    });

    if (!response || response.status !== 200) {
      throw new Error('Git tree request failed');
    }

    const body = await response.text();

    if (
      typeof body !== 'string' ||
      body.length > catalogCore.MAX_UPSTREAM_CHARS
    ) {
      throw new Error('Git tree response is over limit');
    }

    return catalogCore.admitTree(JSON.parse(body), sha);
  }

  // Every child SHA comes from a previously verified parent.
  const root = await fetchTree(snapshot.treeSha, false);

  const docsSha = catalogCore.childTree(root, 'docs');
  const protosSha = catalogCore.childTree(root, 'protos');
  const specSha = catalogCore.childTree(root, 'spec');

  const docs = await fetchTree(docsSha, false);
  const protos = await fetchTree(protosSha, false);

  const treeShas = {
    spec: specSha,
    guide: catalogCore.childTree(docs, 'guide'),
    tutorials: catalogCore.childTree(protos, 'tutorials'),
    examples: catalogCore.childTree(protos, 'examples'),
    library: catalogCore.childTree(protos, 'lib'),
  };

  const names = Object.keys(treeShas);
  const families = Object.create(null);

  for (let i = 0; i < names.length; i++) {
    const family = names[i];

    families[family] = {
      entries: await fetchTree(treeShas[family], true),
    };
  }

  return catalogCore.normalizeCatalog(snapshot, families);
}

export default { createCatalog };
