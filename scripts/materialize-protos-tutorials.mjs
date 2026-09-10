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
import { join, relative, sep } from 'node:path';

const GROUP_RE = /^\d{2}-[a-z0-9-]+$/;
const PROTOS_RE = /\.protos$/;

function humanizeSlug(slug) {
  return slug
    .replace(/^\d{2}-/, '')
    .split('-')
    .filter(Boolean)
    .join(' ')
    .replace(/^./, (character) => character.toUpperCase());
}

function lessonHeading(pathname) {
  const basename = pathname.split('/').at(-1).replace(/\.protos$/, '');
  const match = basename.match(/^(\d{2})-(.+)$/);
  if (!match) return humanizeSlug(basename);
  const title = match[2]
    .split('-')
    .filter(Boolean)
    .join(' ')
    .replace(/^./, (character) => character.toUpperCase());
  return `${match[1]} — ${title}`;
}

function repositoryUrl(lock, path) {
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
    } else if (entry.isFile() && PROTOS_RE.test(entry.name)) {
      files.push(relative(base, full).split(sep).join('/'));
    }
  }
  return files.sort();
}

function sourceGroups(cache) {
  const tutorials = join(cache, 'protos/tutorials');
  if (!existsSync(tutorials) || !statSync(tutorials).isDirectory()) return [];
  return readdirSync(tutorials, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && GROUP_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function chooseFence(source) {
  let longest = 0;
  for (const match of source.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

function renderGroup({ cache, lock, group, previous, next }) {
  const groupDirectory = join(cache, 'protos/tutorials', group);
  const files = collectProtosFiles(groupDirectory);
  if (files.length === 0) {
    throw new Error(`Canonical tutorial group has no .protos lessons: ${group}`);
  }

  const groupNumber = Number.parseInt(group.slice(0, 2), 10);
  const groupTitle = humanizeSlug(group);
  const canonicalGroup =
    `https://github.com/guillermomolina/protos/tree/${lock.revision}/` +
    `protos/tutorials/${group}`;

  const sections = files.map((relativeSource) => {
    const sourcePath = join(groupDirectory, ...relativeSource.split('/'));
    const source = readFileSync(sourcePath, 'utf8');
    if (!source.endsWith('\n')) {
      throw new Error(
        `Canonical tutorial source lacks final newline: ${group}/${relativeSource}`,
      );
    }

    const fence = chooseFence(source);
    const canonicalPath = `protos/tutorials/${group}/${relativeSource}`;
    return `## ${lessonHeading(relativeSource)}

[Canonical source \`${canonicalPath}\`](${repositoryUrl(lock, canonicalPath)})

${fence}protos
${source}${fence}
`;
  });

  const executionNote =
    group === '12-system-resources'
      ? `
:::note[Execution authority]
The canonical tutorial progression deliberately uses more than one execution
host for system-resource lessons. Some examples require an explicitly
provisioned bootstrap-local capability rather than ambient authority. Consult
the [canonical tutorial README](${repositoryUrl(lock, 'protos/tutorials/README.md')})
before running this group.
:::
`
      : '';

  const navigation = [
    previous ? `[← ${humanizeSlug(previous)}](/learn/tutorials/${previous}/)` : null,
    `[Tutorials index](/learn/tutorials/)`,
    next ? `[${humanizeSlug(next)} →](/learn/tutorials/${next}/)` : null,
  ].filter(Boolean).join(' · ');

  return `---
title: ${JSON.stringify(`${groupNumber}. ${groupTitle}`)}
description: ${JSON.stringify(`Canonical executable Protos tutorials: ${groupTitle}.`)}
---

# ${groupNumber}. ${groupTitle}

> **Canonical source:** [\`protos/tutorials/${group}/\`](${canonicalGroup}) at
> locked revision \`${lock.revision}\`.

These are the executable tutorial sources from the exact Protos revision
consumed by this website. The fenced program bodies are copied without
modification. The tutorials are explanatory and non-normative; the applicable
specification remains authoritative.
${executionNote}
${sections.join('\n')}
---

${navigation}
`;
}

function expectedTutorialPages({ cache, lock }) {
  const groups = sourceGroups(cache);
  if (groups.length === 0) {
    throw new Error('Canonical Protos tutorial source contains no numbered groups');
  }

  const pages = new Map();
  groups.forEach((group, index) => {
    pages.set(group, renderGroup({
      cache,
      lock,
      group,
      previous: groups[index - 1] ?? null,
      next: groups[index + 1] ?? null,
    }));
  });
  return pages;
}

function generatedGroups(outputDirectory) {
  if (!existsSync(outputDirectory)) return [];
  return readdirSync(outputDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && GROUP_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function protosTutorialsMatchSource({ root, cache, lock }) {
  const outputDirectory = join(root, 'src/content/docs/learn/tutorials');
  let expected;
  try {
    expected = expectedTutorialPages({ cache, lock });
  } catch {
    return false;
  }

  const expectedGroups = [...expected.keys()].sort();
  if (
    JSON.stringify(generatedGroups(outputDirectory)) !==
    JSON.stringify(expectedGroups)
  ) {
    return false;
  }

  for (const [group, content] of expected) {
    const output = join(outputDirectory, group, 'index.md');
    if (!existsSync(output) || readFileSync(output, 'utf8') !== content) {
      return false;
    }
  }
  return true;
}

export function tutorialSourceInventory(cache) {
  const groups = sourceGroups(cache);
  const lessons = groups.flatMap((group) => {
    const directory = join(cache, 'protos/tutorials', group);
    return collectProtosFiles(directory).map(
      (path) => `protos/tutorials/${group}/${path}`,
    );
  });
  return { groups, lessons };
}

export function materializeProtosTutorials({ root, cache, lock }) {
  const outputDirectory = join(root, 'src/content/docs/learn/tutorials');
  const expected = expectedTutorialPages({ cache, lock });
  const expectedGroups = new Set(expected.keys());

  mkdirSync(outputDirectory, { recursive: true });

  for (const [group, content] of expected) {
    const groupDirectory = join(outputDirectory, group);
    mkdirSync(groupDirectory, { recursive: true });
    const output = join(groupDirectory, 'index.md');
    const temporary = `${output}.tmp-${process.pid}`;
    rmSync(temporary, { force: true });
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, output);
  }

  for (const group of generatedGroups(outputDirectory)) {
    if (!expectedGroups.has(group)) {
      rmSync(join(outputDirectory, group), { recursive: true, force: true });
    }
  }

  if (!protosTutorialsMatchSource({ root, cache, lock })) {
    throw new Error(
      `Generated Protos tutorials do not match locked revision ${lock.revision}`,
    );
  }

  const inventory = tutorialSourceInventory(cache);
  console.log(
    `PROTOS_TUTORIALS_MATERIALIZED: ${lock.revision} ` +
      `groups=${inventory.groups.length} lessons=${inventory.lessons.length}`,
  );
}
