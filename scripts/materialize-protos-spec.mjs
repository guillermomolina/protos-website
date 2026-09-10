import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';

const EXCLUDED_SPEC_DOCUMENTS = new Set([
  'spec/AGENTS.md',
  'spec/PROTOS_SPEC_CHANGELOG.md',
]);

const ROOT_ROUTE_MAP = new Map([
  ['spec/PROTOS_LANGUAGE_SPEC.md', '/reference/language/specification/'],
  ['spec/PROTOS_GRAMMAR.md', '/reference/language/grammar/'],
]);

function kebabName(filename) {
  return filename
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/_/g, '-');
}

function collectMarkdownFiles(directory, base = directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(full, base));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    files.push(relative(base, full).split(sep).join('/'));
  }
  return files.sort();
}

export function specSourceInventory(cache) {
  const specRoot = join(cache, 'spec');
  if (!existsSync(specRoot) || !statSync(specRoot).isDirectory()) {
    throw new Error('Canonical Protos spec source is missing');
  }

  const all = collectMarkdownFiles(specRoot).map((path) => `spec/${path}`);
  const included = all.filter((path) => !EXCLUDED_SPEC_DOCUMENTS.has(path));
  const excluded = all.filter((path) => EXCLUDED_SPEC_DOCUMENTS.has(path));
  return { all, included, excluded };
}

export function specRoute(sourcePath) {
  const rootRoute = ROOT_ROUTE_MAP.get(sourcePath);
  if (rootRoute) return rootRoute;

  if (!sourcePath.startsWith('spec/') || !sourcePath.endsWith('.md')) {
    throw new Error(`Cannot map canonical spec source to route: ${sourcePath}`);
  }

  const relativePath = sourcePath.slice('spec/'.length);
  const components = relativePath.split('/');
  const filename = components.pop();
  const slug = kebabName(filename);
  return `/reference/language/${[...components, slug].join('/')}/`;
}

function outputPathForRoute(route) {
  const prefix = '/reference/language/';
  if (!route.startsWith(prefix) || !route.endsWith('/')) {
    throw new Error(`Unexpected language-reference route: ${route}`);
  }
  return `${route.slice(prefix.length)}index.md`;
}

function encodeRepositoryPath(pathname) {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function splitSuffix(target) {
  const match = target.match(/^([^?#]*)([?#].*)?$/s);
  return {
    pathname: match?.[1] ?? target,
    suffix: match?.[2] ?? '',
  };
}

function isExternal(target) {
  return (
    target.startsWith('#') ||
    target.startsWith('//') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)
  );
}

function canonicalGitHubUrl(lock, canonicalPath, suffix, isImage) {
  const encoded = encodeRepositoryPath(canonicalPath);
  if (isImage) {
    return (
      `https://raw.githubusercontent.com/guillermomolina/protos/` +
      `${lock.revision}/${encoded}${suffix}`
    );
  }

  const kind = canonicalPath.endsWith('/') ? 'tree' : 'blob';
  return (
    `https://github.com/guillermomolina/protos/${kind}/${lock.revision}/` +
    `${encoded}${suffix}`
  );
}

function rewriteRelativeTarget({
  target,
  sourcePath,
  routeBySource,
  lock,
  isImage = false,
}) {
  if (!target || isExternal(target)) return target;

  let wrapped = false;
  let value = target;
  if (value.startsWith('<') && value.endsWith('>')) {
    wrapped = true;
    value = value.slice(1, -1);
  }

  const { pathname, suffix } = splitSuffix(value);
  if (!pathname) return target;

  // Canonical spec documents use repository-relative links. Treat a leading
  // slash as repository-root relative instead of accidentally targeting the
  // website root.
  const currentDirectory = posix.dirname(sourcePath);
  const canonical = pathname.startsWith('/')
    ? posix.normalize(pathname.slice(1))
    : posix.normalize(posix.join(currentDirectory, pathname));

  if (
    canonical === '..' ||
    canonical.startsWith('../') ||
    canonical === ''
  ) {
    throw new Error(
      `Canonical spec link escapes repository root: ${sourcePath} -> ${target}`,
    );
  }

  if (!isImage && routeBySource.has(canonical)) {
    const rewritten = `${routeBySource.get(canonical)}${suffix}`;
    return wrapped ? `<${rewritten}>` : rewritten;
  }

  const rewritten = canonicalGitHubUrl(lock, canonical, suffix, isImage);
  return wrapped ? `<${rewritten}>` : rewritten;
}

function rewriteMarkdownDestination(raw, context) {
  const match = raw.match(/^(<[^>]+>|\S+)(\s+.*)?$/s);
  if (!match) return raw;
  return (
    rewriteRelativeTarget({
      target: match[1],
      ...context,
    }) + (match[2] ?? '')
  );
}

function rewriteProseLine(line, context) {
  let rewritten = line.replace(
    /(!?\[[^\]]*\]\()([^)]+)(\))/g,
    (_match, prefix, destination, suffix) =>
      `${prefix}${rewriteMarkdownDestination(destination, {
        ...context,
        isImage: prefix.startsWith('!'),
      })}${suffix}`,
  );

  rewritten = rewritten.replace(
    /^(\s*\[[^\]]+\]:\s*)(\S+)(.*)$/g,
    (_match, prefix, destination, suffix) =>
      `${prefix}${rewriteRelativeTarget({
        target: destination,
        ...context,
      })}${suffix}`,
  );

  rewritten = rewritten.replace(
    /\b(src|href)="([^"]+)"/g,
    (_match, attribute, destination) =>
      `${attribute}="${rewriteRelativeTarget({
        target: destination,
        ...context,
        isImage: attribute === 'src',
      })}"`,
  );

  return rewritten;
}

function rewriteLinksOutsideFences(source, context) {
  const lines = source.split('\n');
  let fence = null;

  return lines
    .map((line) => {
      const match = line.match(/^\s*(```+|~~~+)/);
      if (match) {
        const marker = match[1][0];
        if (fence === null) {
          fence = marker;
        } else if (fence === marker) {
          fence = null;
        }
        return line;
      }

      if (fence !== null) return line;
      return rewriteProseLine(line, context);
    })
    .join('\n');
}

function firstHeading(source, sourcePath) {
  const lines = source.split('\n');
  let fence = null;
  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const heading = line.match(/^#\s+(.+?)\s*$/);
    if (heading) return heading[1];
  }
  throw new Error(`Canonical spec document has no H1: ${sourcePath}`);
}

function insertProvenance(source, sourcePath, lock) {
  const lines = source.split('\n');
  let fence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null || !/^#\s+\S/.test(line)) continue;

    const canonicalUrl =
      `https://github.com/guillermomolina/protos/blob/${lock.revision}/` +
      encodeRepositoryPath(sourcePath);
    const note = [
      '',
      `> **Canonical source:** [\`${sourcePath}\`](${canonicalUrl}) at locked`,
      `> revision \`${lock.revision}\`. The source document's own status and`,
      '> authority declarations apply; this website rendering does not upgrade,',
      '> downgrade, or redefine them.',
      '',
    ];
    lines.splice(index + 1, 0, ...note);
    return lines.join('\n');
  }

  throw new Error(`Cannot place canonical provenance note: ${sourcePath}`);
}

function expectedSpecPages({ cache, lock }) {
  const inventory = specSourceInventory(cache);
  const routeBySource = new Map(
    inventory.included.map((sourcePath) => [sourcePath, specRoute(sourcePath)]),
  );

  const pages = new Map();
  for (const sourcePath of inventory.included) {
    const sourceFile = join(cache, ...sourcePath.split('/'));
    const source = readFileSync(sourceFile, 'utf8');
    const title = firstHeading(source, sourcePath);
    const withProvenance = insertProvenance(source, sourcePath, lock);
    const rewritten = rewriteLinksOutsideFences(withProvenance, {
      sourcePath,
      routeBySource,
      lock,
    });

    const route = routeBySource.get(sourcePath);
    const outputPath = outputPathForRoute(route);
    pages.set(
      outputPath,
      `---\ntitle: ${JSON.stringify(title)}\n---\n\n${rewritten.replace(/^\n+/, '')}`,
    );
  }

  return { inventory, routeBySource, pages };
}

function generatedRoots(root) {
  const base = join(root, 'src/content/docs/reference/language');
  return [
    'specification',
    'grammar',
    'semantics',
    'concurrency',
    'io',
    'runtime',
  ].map((name) => join(base, name));
}

function currentGeneratedFiles(root) {
  const base = join(root, 'src/content/docs/reference/language');
  return generatedRoots(root)
    .flatMap((directory) =>
      existsSync(directory)
        ? collectMarkdownFiles(directory, base)
        : [],
    )
    .sort();
}

export function protosSpecReferenceMatchesSource({ root, cache, lock }) {
  let expected;
  try {
    expected = expectedSpecPages({ cache, lock });
  } catch {
    return false;
  }

  const expectedFiles = [...expected.pages.keys()].sort();
  const actualFiles = currentGeneratedFiles(root);
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    return false;
  }

  const outputBase = join(root, 'src/content/docs/reference/language');
  for (const [relativePath, content] of expected.pages) {
    const output = join(outputBase, ...relativePath.split('/'));
    if (!existsSync(output) || readFileSync(output, 'utf8') !== content) {
      return false;
    }
  }
  return true;
}

export function materializeProtosSpecReference({ root, cache, lock }) {
  const outputBase = join(root, 'src/content/docs/reference/language');
  const expected = expectedSpecPages({ cache, lock });

  for (const directory of generatedRoots(root)) {
    rmSync(directory, { recursive: true, force: true });
  }

  for (const [relativePath, content] of expected.pages) {
    const output = join(outputBase, ...relativePath.split('/'));
    mkdirSync(dirname(output), { recursive: true });
    const temporary = `${output}.tmp-${process.pid}`;
    rmSync(temporary, { force: true });
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, output);
  }

  if (!protosSpecReferenceMatchesSource({ root, cache, lock })) {
    throw new Error(
      `Generated Protos language reference does not match locked revision ${lock.revision}`,
    );
  }

  console.log(
    `PROTOS_SPEC_REFERENCE_MATERIALIZED: ${lock.revision} ` +
      `documents=${expected.inventory.included.length}`,
  );
}
