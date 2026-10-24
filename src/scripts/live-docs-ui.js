import {
  admitCatalog, admitDocument, sourceHref
} from './live-docs-contract.js';
import { renderMarkdown } from './live-docs-markdown.js';
import { highlightProtosFences } from './live-docs-highlight.js';

export async function mountLiveDocs(doc, fetcher, browser) {
  const list = doc.querySelector('[data-doc-list]');
  const body = doc.querySelector('[data-doc-body]');
  const status = doc.querySelector('[data-doc-status]');
  const identity = doc.querySelector('[data-doc-identity]');
  const family = doc.querySelector('[data-doc-family]');
  const filter = doc.querySelector('[data-doc-filter]');

  if (!list || !body || !status || !identity || !family || !filter) {
    return false;
  }

  const node = (tag, text) => {
    const value = doc.createElement(tag);
    value.textContent = text;
    return value;
  };

  let catalog;
  let generation = 0;

  async function open(entry, updateHistory = true) {
    const current = ++generation;
    body.replaceChildren();
    status.textContent = `Loading ${entry.path}…`;

    if (updateHistory) {
      const url = new URL(browser.location.href);
      url.search = new URLSearchParams({
        family: entry.family, path: entry.path
      }).toString();
      browser.history.pushState(null, '', url);
    }

    const query = new URLSearchParams({
      family: entry.family,
      path: entry.relative
    });

    try {
      const response = await fetcher(
        `/api/live/docs/document?${query}`,
        { method: 'GET', cache: 'no-store',
          headers: { Accept: 'application/json' } }
      );
      if (!response.ok) throw Error('HTTP failure');

      const data = admitDocument(
        await response.json(), catalog, entry
      );
      if (current !== generation) return false;
      if (!data) throw Error('Revision mismatch');

      const title = node('h2', entry.relative);
      const provenance = node(
        'p', `${entry.family} · ${data.kind} · ${catalog.revision}`
      );
      const link = node('a', 'View exact source on GitHub');
      link.href = sourceHref(catalog, entry);
      link.rel = 'noopener noreferrer';
      link.target = '_blank';

      let content;

      if (entry.path.toLowerCase().endsWith('.md')) {
        content = doc.createElement('article');
        content.className = 'live-doc-markdown';

        // HTML comes exclusively from the sanitized Markdown pipeline.
        content.innerHTML = renderMarkdown(
          data.text, catalog, entry
        );
      } else {
        content = doc.createElement('pre');
        const code = doc.createElement('code');
      if (entry.path.toLowerCase().endsWith('.protos')) {
        code.className = 'language-protos';
      }
        code.textContent = data.text;
        content.append(code);
      }

      body.replaceChildren(title, provenance, link, content);

      if (entry.path.toLowerCase().endsWith('.md') ||
        entry.path.toLowerCase().endsWith('.protos')) {
        // Highlight Protos after the content enters the DOM.
        // On failure, the existing inert code remains readable.
        void highlightProtosFences(body).catch(error => {
        console.error('WEB011_HIGHLIGHT_FAILED', error);
      });
      }
      status.textContent = '';
      return true;
    } catch {
      if (current === generation) {
        status.textContent =
          'Document unavailable or revision changed. Reload the catalog.';
      }
      return false;
    }
  }

  function renderList() {
    const query = filter.value.trim().toLowerCase();
    const items = catalog.entries.filter(e =>
      (family.value === 'all' || family.value === e.family) &&
      `${e.family}/${e.relative}`.toLowerCase().includes(query)
    );

    list.replaceChildren(...items.map(e => {
      const li = doc.createElement('li');
      const button = node('button', `${e.family} / ${e.relative}`);
      button.type = 'button';
      button.addEventListener('click', () => { void open(e); });
      li.append(button);
      return li;
    }));
  }

  try {
    const response = await fetcher('/api/live/docs/catalog', {
      method: 'GET', cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw Error('Catalog unavailable');

    catalog = admitCatalog(await response.json());
    if (!catalog) throw Error('Invalid catalog');

    identity.textContent =
      `${catalog.entries.length} documents · ` +
      `commit ${catalog.revision} · tree ${catalog.treeSha}` +
      (catalog.state === 'stale' ? ' · stale' : '');

    filter.addEventListener('input', renderList);
    family.addEventListener('change', renderList);
    renderList();

    status.textContent = 'Select a document.';

    const params = new URLSearchParams(browser.location.search);
    const keys = [...params.keys()];
    if (keys.length === 2 &&
        keys.includes('family') && keys.includes('path')) {
      const selected = catalog.entries.find(e =>
        e.family === params.get('family') &&
        e.path === params.get('path')
      );
      if (selected) await open(selected, false);
    }
    return true;
  } catch {
    status.textContent =
      'Live documentation is unavailable. Use the canonical GitHub source.';
    return false;
  }
}
