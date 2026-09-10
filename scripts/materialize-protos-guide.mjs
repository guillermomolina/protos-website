import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, posix } from 'node:path';

const NUMBERED_GUIDE_RE = /^\d{2}-[a-z0-9-]+\.md$/;
const GENERATED_OUTPUT_RE = /^(?:\d{2}-[a-z0-9-]+|source-style)\.md$/;
const SOURCE_STYLE = 'SOURCE_STYLE.md';

function sourceGuideFiles(cache) {
  const directory = join(cache, 'docs/guide');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => NUMBERED_GUIDE_RE.test(name) || name === SOURCE_STYLE)
    .sort();
}

function outputName(sourceName) {
  return sourceName === SOURCE_STYLE ? 'source-style.md' : sourceName;
}

function outputRoute(sourceName) {
  if (sourceName === 'README.md') return '/learn/guide/';
  const name = outputName(sourceName).replace(/\.md$/, '');
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

  const canonical = posix.normalize(posix.join('docs/guide', pathname));
  if (canonical === '..' || canonical.startsWith('../')) {
    throw new Error(`Guide link escapes canonical repository root: ${target}`);
  }

  if (canonical === 'docs/guide/README.md') {
    const rewritten = `/learn/guide/${suffix}`;
    return wrapped ? `<${rewritten}>` : rewritten;
  }

  if (canonical.startsWith('docs/guide/')) {
    const basename = posix.basename(canonical);
    if (NUMBERED_GUIDE_RE.test(basename) || basename === SOURCE_STYLE) {
      const rewritten = `${outputRoute(basename)}${suffix}`;
      return wrapped ? `<${rewritten}>` : rewritten;
    }
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

  const rewrittenBody = rewriteLinksOutsideFences(body, lock);
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
  const files = sourceGuideFiles(cache);
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

function currentGeneratedNames(outputDirectory) {
  if (!existsSync(outputDirectory)) return [];
  return readdirSync(outputDirectory)
    .filter((name) => GENERATED_OUTPUT_RE.test(name))
    .sort();
}

export function protosGuideMatchesSource({ root, cache, lock }) {
  const outputDirectory = join(root, 'src/content/docs/learn/guide');
  let expected;
  try {
    expected = expectedGuidePages({ cache, lock });
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

  return true;
}

export function materializeProtosGuide({ root, cache, lock }) {
  const outputDirectory = join(root, 'src/content/docs/learn/guide');
  const expected = expectedGuidePages({ cache, lock });
  const expectedNames = new Set(expected.keys());

  mkdirSync(outputDirectory, { recursive: true });

  for (const [name, content] of expected) {
    const output = join(outputDirectory, name);
    const temporary = `${output}.tmp-${process.pid}`;
    rmSync(temporary, { force: true });
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, output);
  }

  for (const name of currentGeneratedNames(outputDirectory)) {
    if (!expectedNames.has(name)) {
      rmSync(join(outputDirectory, name), { force: true });
    }
  }

  if (!protosGuideMatchesSource({ root, cache, lock })) {
    throw new Error(
      `Generated Protos guide does not match locked revision ${lock.revision}`,
    );
  }

  console.log(
    `PROTOS_GUIDE_MATERIALIZED: ${lock.revision} pages=${expected.size}`,
  );
}
