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
import { dirname, join, relative, sep } from 'node:path';

const PROTOS_RE = /\.protos$/;
const TABLE_ROW_RE = /^\|\s*(.+?)\s*\|\s*`([^`]+\.protos)`\s*\|\s*$/;

function canonicalUrl(lock, path) {
  const encoded = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://github.com/guillermomolina/protos/blob/${lock.revision}/${encoded}`;
}

function collectProtosFiles(directory, base = directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectProtosFiles(full, base));
      continue;
    }
    if (!entry.isFile() || !PROTOS_RE.test(entry.name)) continue;
    files.push(relative(base, full).split(sep).join('/'));
  }
  return files.sort();
}

function parseTaskCatalog(sourceRoot) {
  const readme = join(sourceRoot, 'README.md');
  if (!existsSync(readme) || !statSync(readme).isFile()) {
    throw new Error('Canonical examples README.md is missing');
  }

  const rows = [];
  for (const line of readFileSync(readme, 'utf8').split(/\r?\n/)) {
    const match = line.match(TABLE_ROW_RE);
    if (!match) continue;
    rows.push({
      task: match[1].trim(),
      source: match[2].trim(),
    });
  }

  if (rows.length === 0) {
    throw new Error('Canonical examples README contains no task catalog rows');
  }

  const allSources = collectProtosFiles(sourceRoot);
  const listedSources = rows.map(({ source }) => source).sort();
  const uniqueListedSources = [...new Set(listedSources)];

  if (uniqueListedSources.length !== listedSources.length) {
    throw new Error('Canonical examples task catalog contains duplicate source mappings');
  }

  if (JSON.stringify(uniqueListedSources) !== JSON.stringify(allSources)) {
    const listed = new Set(uniqueListedSources);
    const actual = new Set(allSources);
    const unlisted = allSources.filter((path) => !listed.has(path));
    const missing = uniqueListedSources.filter((path) => !actual.has(path));
    throw new Error(
      'Canonical examples task catalog/source inventory mismatch: ' +
        `unlisted=${JSON.stringify(unlisted)} missing=${JSON.stringify(missing)}`,
    );
  }

  return rows;
}

function plainTask(task) {
  return task.replace(/`([^`]+)`/g, '$1').trim();
}

function escapeTableCell(value) {
  return value.replace(/\|/g, '\\|');
}

function exampleRoute(source) {
  return `/learn/examples/programs/${source.replace(/\.protos$/, '')}/`;
}

function chooseFence(source) {
  let longest = 0;
  for (const match of source.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

function renderCatalog({ rows, lock }) {
  const canonicalReadme = canonicalUrl(lock, 'protos/examples/README.md');
  const table = rows
    .map(
      ({ task, source }) =>
        `| ${escapeTableCell(task)} | [\`${source}\`](${exampleRoute(source)}) |`,
    )
    .join('\n');

  return `---
title: Task catalog
description: Task-oriented Protos cookbook generated from the exact locked canonical examples.
---

# Task catalog

> **Canonical source:** [\`protos/examples/README.md\`](${canonicalReadme}) at
> locked revision \`${lock.revision}\`.

This catalog is generated from the task mapping in the canonical Protos
examples README. Each entry opens the exact executable \`.protos\` program from
the same locked source revision.

| Task | Program |
| --- | --- |
${table}

Examples are explanatory and non-normative. The applicable specification
remains authoritative.
`;
}

function renderExample({ sourceRoot, row, index, rows, lock }) {
  const sourcePath = join(sourceRoot, ...row.source.split('/'));
  const source = readFileSync(sourcePath, 'utf8');
  if (!source.endsWith('\n')) {
    throw new Error(`Canonical example source lacks final newline: ${row.source}`);
  }

  const fence = chooseFence(source);
  const canonicalPath = `protos/examples/${row.source}`;
  const previous = index > 0
    ? `[← Previous example](${exampleRoute(rows[index - 1].source)})`
    : null;
  const next = index + 1 < rows.length
    ? `[Next example →](${exampleRoute(rows[index + 1].source)})`
    : null;
  const navigation = [
    previous,
    '[Task catalog](/learn/examples/catalog/)',
    next,
  ].filter(Boolean).join(' · ');

  return `---
title: ${JSON.stringify(plainTask(row.task))}
description: ${JSON.stringify(`Canonical executable Protos example: ${plainTask(row.task)}.`)}
---

# ${row.task}

> **Canonical source:** [\`${canonicalPath}\`](${canonicalUrl(lock, canonicalPath)})
> at locked revision \`${lock.revision}\`.

This executable example is rendered from the exact Protos source consumed by
the website. Its program body is copied without modification.

${fence}protos
${source}${fence}

${navigation}
`;
}

function expectedExamplePages({ cache, lock }) {
  const sourceRoot = join(cache, 'protos/examples');
  const rows = parseTaskCatalog(sourceRoot);
  const pages = new Map();

  pages.set('catalog/index.md', renderCatalog({ rows, lock }));
  rows.forEach((row, index) => {
    const routePath = row.source.replace(/\.protos$/, '');
    pages.set(
      `programs/${routePath}/index.md`,
      renderExample({ sourceRoot, row, index, rows, lock }),
    );
  });

  return { rows, pages };
}

function collectMarkdownFiles(directory, base = directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(full, base));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relative(base, full).split(sep).join('/'));
    }
  }
  return files.sort();
}

export function exampleSourceInventory(cache) {
  const sourceRoot = join(cache, 'protos/examples');
  const rows = parseTaskCatalog(sourceRoot);
  return {
    rows,
    sources: collectProtosFiles(sourceRoot),
  };
}

export function protosExamplesMatchSource({ root, cache, lock }) {
  const outputRoot = join(root, 'src/content/docs/learn/examples');
  let expected;
  try {
    expected = expectedExamplePages({ cache, lock });
  } catch {
    return false;
  }

  const generatedRoots = [
    join(outputRoot, 'catalog'),
    join(outputRoot, 'programs'),
  ];
  const actualFiles = generatedRoots.flatMap((directory) =>
    collectMarkdownFiles(directory, outputRoot),
  ).sort();
  const expectedFiles = [...expected.pages.keys()].sort();

  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    return false;
  }

  for (const [relativePath, content] of expected.pages) {
    const output = join(outputRoot, ...relativePath.split('/'));
    if (!existsSync(output) || readFileSync(output, 'utf8') !== content) {
      return false;
    }
  }
  return true;
}

export function materializeProtosExamples({ root, cache, lock }) {
  const outputRoot = join(root, 'src/content/docs/learn/examples');
  const catalogRoot = join(outputRoot, 'catalog');
  const programsRoot = join(outputRoot, 'programs');
  const { rows, pages } = expectedExamplePages({ cache, lock });

  rmSync(catalogRoot, { recursive: true, force: true });
  rmSync(programsRoot, { recursive: true, force: true });

  for (const [relativePath, content] of pages) {
    const output = join(outputRoot, ...relativePath.split('/'));
    mkdirSync(dirname(output), { recursive: true });
    const temporary = `${output}.tmp-${process.pid}`;
    rmSync(temporary, { force: true });
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, output);
  }

  if (!protosExamplesMatchSource({ root, cache, lock })) {
    throw new Error(
      `Generated Protos examples do not match locked revision ${lock.revision}`,
    );
  }

  console.log(
    `PROTOS_EXAMPLES_MATERIALIZED: ${lock.revision} ` +
      `tasks=${rows.length} programs=${rows.length}`,
  );
}
