import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

const BASE = 'https://protos-document.invalid/';
const BASE_ORIGIN = new URL(BASE).origin;
const MAX_SOURCE = 131072;

function plainText(value) {
  if (typeof value?.value === 'string') return value.value;
  if (typeof value?.alt === 'string') return value.alt;
  if (!Array.isArray(value?.children)) return '';
  return value.children.map(plainText).join('');
}

function safeHref(raw, catalog, entry) {
  if (
    typeof raw !== 'string' || !raw || raw.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(raw)
  ) return null;

  let url;
  try {
    url = new URL(raw, new URL(entry.path, BASE));
  } catch {
    return null;
  }

  if (url.username || url.password) return null;

  if (url.origin === BASE_ORIGIN) {
    if (url.search) return null;
    let path;
    try {
      path = decodeURIComponent(url.pathname.slice(1));
    } catch {
      return null;
    }

    const target = catalog.entries.find(item => item.path === path);
    if (!target) return null;

    const query = new URLSearchParams({
      family: target.family,
      path: target.path
    });

    return `/docs/live/?${query}${url.hash}`;
  }

  if (url.protocol === 'https:' || url.protocol === 'http:') {
    return url.href;
  }

  return null;
}

function canonicalLinks(catalog, entry) {
  return tree => {
    function walk(parent) {
      if (!Array.isArray(parent.children)) return;

      parent.children = parent.children.map(child => {
        if (child.type === 'image' || child.type === 'imageReference') {
          return { type: 'text', value: child.alt || '' };
        }

        if (child.type === 'html') {
          return { type: 'text', value: child.value || '' };
        }

        if (child.type === 'link' || child.type === 'definition') {
          const href = safeHref(child.url, catalog, entry);

          if (!href && child.type === 'link') {
            return { type: 'text', value: plainText(child) };
          }

          child.url = href || '#';
          child.title = null;
        }

        walk(child);
        return child;
      });
    }

    walk(tree);
  };
}

export function renderMarkdown(source, catalog, entry) {
  if (
    typeof source !== 'string' ||
    source.length > MAX_SOURCE ||
    !catalog ||
    !Array.isArray(catalog.entries) ||
    !entry ||
    typeof entry.path !== 'string' ||
    !catalog.entries.some(item => item.path === entry.path)
  ) {
    throw new Error('Invalid canonical Markdown input');
  }

  return String(unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(canonicalLinks, catalog, entry)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSanitize)
    .use(rehypeStringify)
    .processSync(source));
}
