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

const NUMBERED_GUIDE_RE = /^\d{2}-[a-z0-9-]+\.md$/;
const GENERATED_OUTPUT_RE = /^(?:\d{2}-[a-z0-9-]+|source-style)\.md$/;
const SECTION_RE = /^[a-z0-9-]+$/;
const SECTION_PAGE_RE = /^(?:README|[a-z0-9-]+)\.md$/;
const SOURCE_STYLE = 'SOURCE_STYLE.md';
const TRY_PROTOS = '00-try-protos.md';

// Guide pages are identified by their path relative to docs/guide: top-level
// numbered chapters and SOURCE_STYLE.md, plus the Markdown pages of one level
// of topic sections such as `tools/cli.md` or `embedding/java.md`.
function isGuidePage(relativePath) {
  const parts = relativePath.split('/');
  if (parts.length === 1) {
    return NUMBERED_GUIDE_RE.test(parts[0]) || parts[0] === SOURCE_STYLE;
  }
  return (
    parts.length === 2 &&
    SECTION_RE.test(parts[0]) &&
    SECTION_PAGE_RE.test(parts[1])
  );
}

function sourceGuideFiles(cache) {
  const directory = join(cache, 'docs/guide');
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && isGuidePage(entry.name)) {
      files.push(entry.name);
    } else if (entry.isDirectory() && SECTION_RE.test(entry.name)) {
      for (const name of readdirSync(join(directory, entry.name))) {
        const relativePath = `${entry.name}/${name}`;
        if (isGuidePage(relativePath)) files.push(relativePath);
      }
    }
  }
  return files.sort();
}

function outputName(sourceName) {
  if (sourceName === SOURCE_STYLE) return 'source-style.md';
  if (sourceName.endsWith('/README.md')) {
    return sourceName.replace(/README\.md$/, 'index.md');
  }
  return sourceName;
}

function outputRoute(sourceName) {
  if (sourceName === 'README.md') return '/learn/guide/';
  if (sourceName === TRY_PROTOS) return '/learn/getting-started/';
  const name = outputName(sourceName).replace(/(?:\/index)?\.md$/, '');
  return `/learn/guide/${name}/`;
}

function encodeRepositoryPath(pathname) {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
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

function rewriteRelativeTarget(target, lock, sourceName) {
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

  const canonical = posix.normalize(
    posix.join(posix.dirname(`docs/guide/${sourceName}`), pathname),
  );
  if (canonical === '..' || canonical.startsWith('../')) {
    throw new Error(`Guide link escapes canonical repository root: ${target}`);
  }

  if (canonical === 'docs/guide/README.md') {
    const rewritten = `/learn/guide/${suffix}`;
    return wrapped ? `<${rewritten}>` : rewritten;
  }

  if (canonical.startsWith('docs/guide/')) {
    const relativePath = canonical.slice('docs/guide/'.length);
    if (relativePath === TRY_PROTOS || isGuidePage(relativePath)) {
      const rewritten = `${outputRoute(relativePath)}${suffix}`;
      return wrapped ? `<${rewritten}>` : rewritten;
    }
  }

  if (canonical === 'protos/tutorials/README.md') {
    const rewritten = `/learn/tutorials/${suffix}`;
    return wrapped ? `<${rewritten}>` : rewritten;
  }

  if (canonical === 'protos/examples/README.md') {
    const rewritten = `/learn/examples/${suffix}`;
    return wrapped ? `<${rewritten}>` : rewritten;
  }

  if (canonical.startsWith('docs/assets/branding/')) {
    const rewritten = `/protos-branding/${posix.basename(canonical)}${suffix}`;
    return wrapped ? `<${rewritten}>` : rewritten;
  }

  const kind = pathname.endsWith('/') ? 'tree' : 'blob';
  const encodedPath = encodeRepositoryPath(canonical);
  const rewritten =
    `https://github.com/guillermomolina/protos/${kind}/${lock.revision}/` +
    `${encodedPath}${suffix}`;
  return wrapped ? `<${rewritten}>` : rewritten;
}

function rewriteMarkdownDestination(raw, lock, sourceName) {
  const match = raw.match(/^(<[^>]+>|\S+)(\s+.*)?$/s);
  if (!match) return raw;
  return `${rewriteRelativeTarget(match[1], lock, sourceName)}${match[2] ?? ''}`;
}

function rewriteProseLine(line, lock, sourceName) {
  let rewritten = line.replace(
    /(!?\[[^\]]*\]\()([^)]+)(\))/g,
    (_match, prefix, destination, suffix) =>
      `${prefix}${rewriteMarkdownDestination(destination, lock, sourceName)}${suffix}`,
  );

  rewritten = rewritten.replace(
    /^(\s*\[[^\]]+\]:\s*)(\S+)(.*)$/g,
    (_match, prefix, destination, suffix) =>
      `${prefix}${rewriteRelativeTarget(destination, lock, sourceName)}${suffix}`,
  );

  rewritten = rewritten.replace(
    /\b(src|href)="([^"]+)"/g,
    (_match, attribute, destination) =>
      `${attribute}="${rewriteRelativeTarget(destination, lock, sourceName)}"`,
  );

  return rewritten;
}

function rewriteLinksOutsideFences(source, lock, sourceName) {
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
      return rewriteProseLine(line, lock, sourceName);
    })
    .join('\n');
}

function extractTitleAndBody(source, sourceName) {
  const lines = source.split('\n');
  const index = lines.findIndex((line) => /^#\s+\S/.test(line));
  if (index < 0) {
    throw new Error(`Canonical guide page has no H1: ${sourceName}`);
  }

  const title = lines[index].replace(/^#\s+/, '').trim();
  lines.splice(index, 1);

  while (lines[index] === '') {
    lines.splice(index, 1);
  }

  return {
    title,
    body: lines.join('\n').replace(/^\n+/, ''),
  };
}

export function transformGuideMarkdown(source, sourceName, lock) {
  const { title, body } = extractTitleAndBody(source, sourceName);
  const canonicalPath = `docs/guide/${sourceName}`;
  const canonicalUrl =
    `https://github.com/guillermomolina/protos/blob/${lock.revision}/` +
    canonicalPath;

  const rewrittenBody = rewriteLinksOutsideFences(body, lock, sourceName);
  const titleJson = JSON.stringify(title);

  return `---
title: ${titleJson}
---

> **Canonical source:** [\`${canonicalPath}\`](${canonicalUrl}) at locked
> revision \`${lock.revision}\`. This rendered page is non-normative; the
> applicable Protos specification remains authoritative.

${rewrittenBody}
`;
}

function expectedGuidePages({ cache, lock }) {
  const files = sourceGuideFiles(cache).filter((name) => name !== TRY_PROTOS);
  if (files.length === 0) {
    throw new Error('Canonical Protos guide source contains no renderable pages');
  }

  const pages = new Map();
  for (const sourceName of files) {
    const sourcePath = join(cache, 'docs/guide', sourceName);
    const rendered = transformGuideMarkdown(
      readFileSync(sourcePath, 'utf8'),
      sourceName,
      lock,
    );
    pages.set(outputName(sourceName), rendered);
  }
  return pages;
}

function expectedGettingStartedPage({ cache, lock }) {
  const sourcePath = join(cache, 'docs/guide', TRY_PROTOS);
  if (!existsSync(sourcePath)) {
    throw new Error(`Canonical Protos guide page missing: ${TRY_PROTOS}`);
  }

  return transformGuideMarkdown(
    readFileSync(sourcePath, 'utf8'),
    TRY_PROTOS,
    lock,
  );
}

function currentGeneratedNames(outputDirectory) {
  if (!existsSync(outputDirectory)) return [];
  const names = [];
  for (const entry of readdirSync(outputDirectory, { withFileTypes: true })) {
    if (entry.isFile() && GENERATED_OUTPUT_RE.test(entry.name)) {
      names.push(entry.name);
    } else if (entry.isDirectory()) {
      for (const name of readdirSync(join(outputDirectory, entry.name))) {
        names.push(`${entry.name}/${name}`);
      }
    }
  }
  return names.sort();
}

export function protosGuideMatchesSource({ root, cache, lock }) {
  const outputDirectory = join(root, 'src/content/docs/learn/guide');
  const gettingStartedOutput = join(
    root,
    'src/content/docs/learn/getting-started/index.md',
  );

  let expected;
  let expectedGettingStarted;
  try {
    expected = expectedGuidePages({ cache, lock });
    expectedGettingStarted = expectedGettingStartedPage({ cache, lock });
  } catch {
    return false;
  }

  const expectedNames = [...expected.keys()].sort();
  const actualNames = currentGeneratedNames(outputDirectory);
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    return false;
  }

  for (const [name, content] of expected) {
    const output = join(outputDirectory, name);
    if (!existsSync(output) || readFileSync(output, 'utf8') !== content) {
      return false;
    }
  }

  if (
    !existsSync(gettingStartedOutput) ||
    readFileSync(gettingStartedOutput, 'utf8') !== expectedGettingStarted
  ) {
    return false;
  }

  return true;
}

export function materializeProtosGuide({ root, cache, lock }) {
  const outputDirectory = join(root, 'src/content/docs/learn/guide');
  const gettingStartedDirectory = join(
    root,
    'src/content/docs/learn/getting-started',
  );
  const gettingStartedOutput = join(gettingStartedDirectory, 'index.md');

  const expected = expectedGuidePages({ cache, lock });
  const expectedGettingStarted = expectedGettingStartedPage({ cache, lock });
  const expectedNames = new Set(expected.keys());

  mkdirSync(outputDirectory, { recursive: true });
  mkdirSync(gettingStartedDirectory, { recursive: true });

  for (const [name, content] of expected) {
    const output = join(outputDirectory, name);
    mkdirSync(dirname(output), { recursive: true });
    const temporary = `${output}.tmp-${process.pid}`;
    rmSync(temporary, { force: true });
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, output);
  }

  const gettingStartedTemporary =
    `${gettingStartedOutput}.tmp-${process.pid}`;
  rmSync(gettingStartedTemporary, { force: true });
  writeFileSync(gettingStartedTemporary, expectedGettingStarted, 'utf8');
  renameSync(gettingStartedTemporary, gettingStartedOutput);

  for (const name of currentGeneratedNames(outputDirectory)) {
    if (!expectedNames.has(name)) {
      rmSync(join(outputDirectory, name), { force: true });
    }
  }

  for (const entry of readdirSync(outputDirectory, { withFileTypes: true })) {
    const directory = join(outputDirectory, entry.name);
    if (entry.isDirectory() && readdirSync(directory).length === 0) {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  if (!protosGuideMatchesSource({ root, cache, lock })) {
    throw new Error(
      `Generated Protos guide does not match locked revision ${lock.revision}`,
    );
  }

  console.log(
    `PROTOS_GUIDE_MATERIALIZED: ${lock.revision} ` +
      `pages=${expected.size} getting_started=1`,
  );
}
