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

function canonicalBlobUrl(lock, sourcePath) {
  const encoded = sourcePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return (
    `https://github.com/guillermomolina/protos/blob/${lock.revision}/` +
    encoded
  );
}

function canonicalTreeUrl(lock, sourcePath) {
  const encoded = sourcePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return (
    `https://github.com/guillermomolina/protos/tree/${lock.revision}/` +
    encoded
  );
}

function collectProtosFiles(directory, base = directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectProtosFiles(full, base));
      continue;
    }
    if (entry.isFile() && PROTOS_RE.test(entry.name)) {
      files.push(relative(base, full).split(sep).join('/'));
    }
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

function sourceFamilies(cache) {
  const libRoot = join(cache, 'protos/lib');
  if (!existsSync(libRoot) || !statSync(libRoot).isDirectory()) {
    throw new Error('Canonical Protos library source is missing');
  }

  return readdirSync(libRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function sourceRoute(family, relativeSource) {
  const modulePath = relativeSource.replace(/\.protos$/, '').toLowerCase();
  return `/reference/standard-library/source/${family}/${modulePath}/`;
}

function chooseFence(source) {
  let longest = 0;
  for (const match of source.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

function renderSourceIndex({ inventory, lock }) {
  const rows = inventory.families
    .map(({ family, modules }) =>
      `| [\`${family}\`](/reference/standard-library/source/${family}/) | ${modules.length} |`,
    )
    .join('\n');

  return `---
title: Library source
description: Exact-SHA source browser for the Protos standard-library implementation.
---

# Standard-library source

> **Canonical source root:** [\`protos/lib/\`](${canonicalTreeUrl(lock, 'protos/lib')})
> at locked revision \`${lock.revision}\`.

This is a **source browser**, not an inferred API specification. It exposes the
library implementation that belongs to the exact Protos snapshot consumed by
this website while preserving the distinction between implementation source
and observable language/library contracts.

| Family | Source modules |
| --- | ---: |
${rows}

The generated module pages preserve source filenames, case, relative paths, and
program bodies. They do not infer exports, signatures, public/private status,
stability guarantees, or semantic contracts from implementation structure.

For defined language behavior, use the
[Language reference](/reference/language/).
`;
}

function renderFamily({ family, modules, cache, lock }) {
  const familyRoot = join(cache, 'protos/lib', family);
  const readmePath = join(familyRoot, 'README.md');
  const readmeNote = existsSync(readmePath)
    ? `

This family also contains a maintained
[canonical README](${canonicalBlobUrl(lock, `protos/lib/${family}/README.md`)})
at the same locked revision. It is linked rather than converted into an API
contract.`
    : '';

  const rows = modules
    .map((relativeSource) => {
      const sourcePath = `protos/lib/${family}/${relativeSource}`;
      return (
        `| [\`${relativeSource}\`](${sourceRoute(family, relativeSource)}) | ` +
        `[source](${canonicalBlobUrl(lock, sourcePath)}) |`
      );
    })
    .join('\n');

  return `---
title: ${JSON.stringify(family)}
description: ${JSON.stringify(`Canonical Protos library source family: ${family}.`)}
---

# \`${family}\`

> **Canonical source:** [\`protos/lib/${family}/\`](${canonicalTreeUrl(
    lock,
    `protos/lib/${family}`,
  )}) at locked revision \`${lock.revision}\`.

This page inventories the exact \`.protos\` sources in the \`${family}\`
library family. Source presence or top-level slot structure is **not** by itself
a declaration of stable public API.${readmeNote}

| Module source | Canonical file |
| --- | --- |
${rows}

[← Standard-library source](/reference/standard-library/source/) ·
[Standard library](/reference/standard-library/)
`;
}

function renderModule({ family, relativeSource, source, lock }) {
  if (!source.endsWith('\n')) {
    throw new Error(
      `Canonical library source lacks final newline: ${family}/${relativeSource}`,
    );
  }

  const sourcePath = `protos/lib/${family}/${relativeSource}`;
  const title = relativeSource.replace(/\.protos$/, '');
  const fence = chooseFence(source);

  return `---
title: ${JSON.stringify(title)}
description: ${JSON.stringify(`Exact canonical Protos source: ${sourcePath}.`)}
---

# \`${title}\`

> **Canonical source:** [\`${sourcePath}\`](${canonicalBlobUrl(lock, sourcePath)})
> at locked revision \`${lock.revision}\`.

:::caution[Source, not API contract]
This page reproduces the implementation source exactly. Do not infer exports,
stable signatures, public/private status, compatibility guarantees, or
normative semantics merely from source structure. The applicable Protos
specification and explicitly maintained library contracts remain authoritative.
:::

${fence}protos
${source}${fence}

[← \`${family}\` family](/reference/standard-library/source/${family}/) ·
[Standard-library source](/reference/standard-library/source/)
`;
}

export function librarySourceInventory(cache) {
  const libRoot = join(cache, 'protos/lib');
  const families = sourceFamilies(cache).map((family) => {
    const directory = join(libRoot, family);
    return {
      family,
      modules: collectProtosFiles(directory),
    };
  });

  return {
    families,
    moduleCount: families.reduce(
      (sum, { modules }) => sum + modules.length,
      0,
    ),
  };
}

function expectedPages({ cache, lock }) {
  const inventory = librarySourceInventory(cache);
  const pages = new Map();

  pages.set('index.md', renderSourceIndex({ inventory, lock }));

  for (const { family, modules } of inventory.families) {
    pages.set(
      `${family}/index.md`,
      renderFamily({ family, modules, cache, lock }),
    );

    for (const relativeSource of modules) {
      const sourceFile = join(
        cache,
        'protos/lib',
        family,
        ...relativeSource.split('/'),
      );
      const source = readFileSync(sourceFile, 'utf8');
      const modulePath = relativeSource.replace(/\.protos$/, '').toLowerCase();
      pages.set(
        `${family}/${modulePath}/index.md`,
        renderModule({ family, relativeSource, source, lock }),
      );
    }
  }

  return { inventory, pages };
}

function collectGeneratedMarkdown(directory, base = directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectGeneratedMarkdown(full, base));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relative(base, full).split(sep).join('/'));
    }
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

export function protosLibrarySourceMatches({ root, cache, lock }) {
  let expected;
  try {
    expected = expectedPages({ cache, lock });
  } catch {
    return false;
  }

  const outputRoot = join(
    root,
    'src/content/docs/reference/standard-library/source',
  );
  const actualFiles = collectGeneratedMarkdown(outputRoot);
  const expectedFiles = [...expected.pages.keys()].sort((left, right) =>
    left.localeCompare(right, 'en'),
  );

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

export function materializeProtosLibrarySource({ root, cache, lock }) {
  const outputRoot = join(
    root,
    'src/content/docs/reference/standard-library/source',
  );
  const { inventory, pages } = expectedPages({ cache, lock });

  rmSync(outputRoot, { recursive: true, force: true });

  for (const [relativePath, content] of pages) {
    const output = join(outputRoot, ...relativePath.split('/'));
    mkdirSync(dirname(output), { recursive: true });
    const temporary = `${output}.tmp-${process.pid}`;
    rmSync(temporary, { force: true });
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, output);
  }

  if (!protosLibrarySourceMatches({ root, cache, lock })) {
    throw new Error(
      `Generated Protos library source browser does not match locked revision ${lock.revision}`,
    );
  }

  console.log(
    `PROTOS_LIBRARY_SOURCE_MATERIALIZED: ${lock.revision} ` +
      `families=${inventory.families.length} modules=${inventory.moduleCount}`,
  );
}
