import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix } from 'node:path';

const NEWS_ENTRY_RE = /^(\d{4}-\d{2}-\d{2})-[a-z0-9-]+\.md$/;
const INDEX_ENTRY_RE = /^- \*\*(\d{4}-\d{2}-\d{2}) — \[([^\]]+)\]\(([^)]+\.md)\)\*\*\s*$/;

function sourceNewsFiles(cache) {
  const directory = join(cache, 'docs/news');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => NEWS_ENTRY_RE.test(name))
    .sort();
}

function routeForSource(sourceName) {
  return `/community/news/${sourceName.replace(/\.md$/, '')}/`;
}

function splitPathSuffix(target) {
  const match = target.match(/^([^?#]*)([?#].*)?$/s);
  return {
    pathname: match?.[1] ?? target,
    suffix: match?.[2] ?? '',
  };
}

function isExternalOrSiteAbsolute(target) {
  return (
    target.startsWith('#') ||
    target.startsWith('/') ||
    target.startsWith('//') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)
  );
}

function encodeRepositoryPath(pathname) {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function rewriteRelativeTarget(target, lock) {
  if (!target || isExternalOrSiteAbsolute(target)) return target;

  let wrapped = false;
  let value = target;
  if (value.startsWith('<') && value.endsWith('>')) {
    wrapped = true;
    value = value.slice(1, -1);
  }
  if (isExternalOrSiteAbsolute(value)) return target;

  const { pathname, suffix } = splitPathSuffix(value);
  if (!pathname) return target;

  const canonical = posix.normalize(posix.join('docs/news', pathname));
  if (canonical === '..' || canonical.startsWith('../')) {
    throw new Error(`News link escapes canonical repository root: ${target}`);
  }

  if (canonical === 'docs/news/README.md') {
    const rewritten = `/community/news/${suffix}`;
    return wrapped ? `<${rewritten}>` : rewritten;
  }

  if (canonical.startsWith('docs/news/')) {
    const basename = posix.basename(canonical);
    if (NEWS_ENTRY_RE.test(basename)) {
      const rewritten = `${routeForSource(basename)}${suffix}`;
      return wrapped ? `<${rewritten}>` : rewritten;
    }
  }

  const kind = pathname.endsWith('/') ? 'tree' : 'blob';
  const encodedPath = encodeRepositoryPath(canonical);
  const rewritten =
    `https://github.com/guillermomolina/protos/${kind}/${lock.revision}/` +
    `${encodedPath}${suffix}`;
  return wrapped ? `<${rewritten}>` : rewritten;
}

function rewriteMarkdownDestination(raw, lock) {
  const match = raw.match(/^(<[^>]+>|\S+)(\s+.*)?$/s);
  if (!match) return raw;
  return `${rewriteRelativeTarget(match[1], lock)}${match[2] ?? ''}`;
}

function rewriteProseLine(line, lock) {
  let rewritten = line.replace(
    /(!?\[[^\]]*\]\()([^)]+)(\))/g,
    (_match, prefix, destination, suffix) =>
      `${prefix}${rewriteMarkdownDestination(destination, lock)}${suffix}`,
  );

  rewritten = rewritten.replace(
    /^(\s*\[[^\]]+\]:\s*)(\S+)(.*)$/g,
    (_match, prefix, destination, suffix) =>
      `${prefix}${rewriteRelativeTarget(destination, lock)}${suffix}`,
  );

  rewritten = rewritten.replace(
    /\b(src|href)="([^"]+)"/g,
    (_match, attribute, destination) =>
      `${attribute}="${rewriteRelativeTarget(destination, lock)}"`,
  );

  return rewritten;
}

function rewriteLinksOutsideFences(source, lock) {
  const lines = source.split('\n');
  let fence = null;

  return lines
    .map((line) => {
      const fenceMatch = line.match(/^\s*(```+|~~~+)/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (fence === null) {
          fence = marker;
        } else if (fence === marker) {
          fence = null;
        }
        return line;
      }

      if (fence !== null) return line;
      return rewriteProseLine(line, lock);
    })
    .join('\n');
}

function extractTitleAndBody(source, sourceName) {
  const lines = source.split('\n');
  const index = lines.findIndex((line) => /^#\s+\S/.test(line));
  if (index < 0) {
    throw new Error(`Canonical news page has no H1: ${sourceName}`);
  }

  const title = lines[index].replace(/^#\s+/, '').trim();
  lines.splice(index, 1);
  while (lines[index] === '') lines.splice(index, 1);

  return {
    title,
    body: lines.join('\n').replace(/^\n+/, ''),
  };
}

function parseNewsIndex(source) {
  const lines = source.split('\n');
  const entries = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(INDEX_ENTRY_RE);
    if (!match) continue;

    const [, date, title, sourceName] = match;
    if (!NEWS_ENTRY_RE.test(sourceName)) {
      throw new Error(`Unsupported canonical news entry name: ${sourceName}`);
    }
    if (!sourceName.startsWith(`${date}-`)) {
      throw new Error(`Canonical news index date/file mismatch: ${sourceName}`);
    }

    const summary = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.trim() === '' || INDEX_ENTRY_RE.test(line) || /^##\s+/.test(line)) {
        break;
      }
      summary.push(line.trim());
    }

    if (summary.length === 0) {
      throw new Error(`Canonical news index entry has no summary: ${sourceName}`);
    }

    const canonicalSummary = summary.join(' ').replace(/\s+/g, ' ').trim();
    const plainSummary = canonicalSummary
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1');

    entries.push({
      date,
      title,
      sourceName,
      summary: plainSummary,
      href: routeForSource(sourceName),
    });
  }

  if (entries.length === 0) {
    throw new Error('Canonical Protos news index contains no entries');
  }

  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1].date < entries[index].date) {
      throw new Error('Canonical Protos news index is not reverse chronological');
    }
  }

  return entries;
}

function canonicalSourceNotice(canonicalPath, lock) {
  const canonicalUrl =
    `https://github.com/guillermomolina/protos/blob/${lock.revision}/` +
    canonicalPath;
  return `> **Canonical source:** [\`${canonicalPath}\`](${canonicalUrl}) at locked\n> revision \`${lock.revision}\`. This page is derived presentation; the canonical\n> milestone record remains in \`guillermomolina/protos\`.\n`;
}

function transformArticle(source, sourceName, entry, lock) {
  const { title, body } = extractTitleAndBody(source, sourceName);
  if (title !== entry.title) {
    throw new Error(
      `Canonical news title mismatch for ${sourceName}: index=${entry.title} article=${title}`,
    );
  }

  const frontmatter = `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(entry.summary)}\n---\n`;
  const rewrittenBody = rewriteLinksOutsideFences(body, lock);
  return `${frontmatter}\n${canonicalSourceNotice(`docs/news/${sourceName}`, lock)}\n${rewrittenBody}\n`;
}

function transformIndex(source, lock) {
  const { title, body } = extractTitleAndBody(source, 'README.md');
  const rewrittenBody = rewriteLinksOutsideFences(body, lock);
  return `---\ntitle: ${JSON.stringify(title)}\ndescription: "Durable, versioned Protos project milestones."\n---\n\n${canonicalSourceNotice('docs/news/README.md', lock)}\n${rewrittenBody}\n`;
}

function expectedNews({ cache, lock }) {
  const directory = join(cache, 'docs/news');
  const indexPath = join(directory, 'README.md');
  if (!existsSync(indexPath)) {
    throw new Error('Canonical Protos news index is missing');
  }

  const indexSource = readFileSync(indexPath, 'utf8');
  const entries = parseNewsIndex(indexSource);
  const files = sourceNewsFiles(cache);
  const indexedFiles = entries.map((entry) => entry.sourceName).sort();
  if (JSON.stringify(files) !== JSON.stringify(indexedFiles)) {
    throw new Error('Canonical Protos news files and index entries do not match');
  }

  const pages = new Map();
  pages.set('index.md', transformIndex(indexSource, lock));
  for (const entry of entries) {
    const source = readFileSync(join(directory, entry.sourceName), 'utf8');
    pages.set(entry.sourceName, transformArticle(source, entry.sourceName, entry, lock));
  }

  return { entries, pages };
}

function currentGeneratedNames(outputDirectory) {
  if (!existsSync(outputDirectory)) return [];
  return readdirSync(outputDirectory)
    .filter((name) => name === 'index.md' || NEWS_ENTRY_RE.test(name))
    .sort();
}

function manifestContent(entries, lock) {
  return `${JSON.stringify(
    {
      revision: lock.revision,
      entries,
    },
    null,
    2,
  )}\n`;
}

export function protosNewsMatchesSource({ root, cache, lock }) {
  const outputDirectory = join(root, 'src/content/docs/community/news');
  const manifestPath = join(root, 'src/generated/protos-news.json');
  let expected;
  try {
    expected = expectedNews({ cache, lock });
  } catch {
    return false;
  }

  const expectedNames = [...expected.pages.keys()].sort();
  if (
    JSON.stringify(currentGeneratedNames(outputDirectory)) !==
    JSON.stringify(expectedNames)
  ) {
    return false;
  }

  for (const [name, content] of expected.pages) {
    const output = join(outputDirectory, name);
    if (!existsSync(output) || readFileSync(output, 'utf8') !== content) {
      return false;
    }
  }

  return (
    existsSync(manifestPath) &&
    readFileSync(manifestPath, 'utf8') === manifestContent(expected.entries, lock)
  );
}

export function materializeProtosNews({ root, cache, lock }) {
  const outputDirectory = join(root, 'src/content/docs/community/news');
  const manifestPath = join(root, 'src/generated/protos-news.json');
  const expected = expectedNews({ cache, lock });

  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  for (const [name, content] of expected.pages) {
    const output = join(outputDirectory, name);
    const temporary = `${output}.tmp-${process.pid}`;
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, output);
  }

  mkdirSync(dirname(manifestPath), { recursive: true });
  const temporaryManifest = `${manifestPath}.tmp-${process.pid}`;
  writeFileSync(
    temporaryManifest,
    manifestContent(expected.entries, lock),
    'utf8',
  );
  renameSync(temporaryManifest, manifestPath);

  if (!protosNewsMatchesSource({ root, cache, lock })) {
    throw new Error(
      `Generated Protos news does not match locked revision ${lock.revision}`,
    );
  }

  console.log(
    `PROTOS_NEWS_MATERIALIZED: ${lock.revision} entries=${expected.entries.length}`,
  );
}
