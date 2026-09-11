import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const ARTIFACT_FILE = '.protos-documentation.json';
const COVERAGE_FILE = '.protos-documentation.coverage.txt';
const EXTRACTOR_CLASS =
  'com.guillermomolina.protos.documentation.ProtosStandardLibraryDocumentationExtractor';
const PRODUCER_IMAGE =
  'maven:3.9.16-eclipse-temurin-21@sha256:a972570be789ee5c9fa23446a8914ac7327560b5c022f662cfa9452aef829f18';

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalBlobUrl(lock, sourcePath, range = null) {
  const encoded = sourcePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  let url =
    `https://github.com/guillermomolina/protos/blob/${lock.revision}/` +
    encoded;
  if (range?.start?.line) {
    url += `#L${range.start.line}`;
    if (range.end?.line && range.end.line > range.start.line) {
      url += `-L${range.end.line}`;
    }
  }
  return url;
}

function markdownCode(value) {
  const text = String(value);
  const runs = [...text.matchAll(/`+/g)].map((match) => match[0].length);
  const fence = '`'.repeat(Math.max(0, ...runs) + 1);
  return `${fence}${text}${fence}`;
}

function sourceBrowserRoute(sourcePath) {
  const prefix = 'protos/lib/';
  if (!sourcePath.startsWith(prefix) || !sourcePath.endsWith('.protos')) {
    throw new Error(`Unexpected Standard Library source path: ${sourcePath}`);
  }
  const logical = sourcePath
    .slice(prefix.length, -'.protos'.length)
    .toLowerCase();
  return `/reference/standard-library/source/${logical}/`;
}

function moduleLogicalName(module) {
  const identity = module?.identity;
  if (
    identity?.kind !== 'std' ||
    typeof identity.name !== 'string' ||
    !identity.name.startsWith('std:')
  ) {
    throw new Error('D064 module is not a canonical std: identity');
  }
  const logical = identity.name.slice('std:'.length);
  if (!logical || logical === 'core' || logical.startsWith('core/')) {
    throw new Error(`Invalid importable Standard Library identity: ${identity.name}`);
  }
  return logical;
}

function moduleRoute(module) {
  return `/reference/standard-library/api/${moduleLogicalName(module).toLowerCase()}/`;
}

function artifactPath(cache) {
  return join(cache, ARTIFACT_FILE);
}

function coveragePath(cache) {
  return join(cache, COVERAGE_FILE);
}

function validateSource(source) {
  if (
    !source ||
    typeof source.path !== 'string' ||
    source.path.startsWith('/') ||
    source.path.includes('\\') ||
    !source.path.startsWith('protos/lib/')
  ) {
    throw new Error('D064 artifact contains invalid Standard Library source provenance');
  }
  if (
    !source.range ||
    !Number.isInteger(source.range.start?.line) ||
    !Number.isInteger(source.range.start?.column) ||
    !Number.isInteger(source.range.end?.line) ||
    !Number.isInteger(source.range.end?.column)
  ) {
    throw new Error(`D064 artifact contains invalid source range: ${source.path}`);
  }
}

function validateDocumentation(value, label) {
  if (value !== null && typeof value !== 'string') {
    throw new Error(`${label} documentation must be string or null`);
  }
}

export function validateProtosLibraryDocumentationArtifact(artifact, lock) {
  if (
    artifact?.format?.name !== 'protos-documentation' ||
    artifact.format.major !== 1 ||
    artifact.format.minor !== 0
  ) {
    throw new Error('Unsupported D064 documentation artifact format');
  }
  if (
    artifact?.provenance?.kind !== 'repositoryRevision' ||
    artifact.provenance.repository !== 'guillermomolina/protos' ||
    artifact.provenance.revision !== lock.revision
  ) {
    throw new Error(
      `D064 provenance mismatch: expected guillermomolina/protos@${lock.revision}`,
    );
  }
  if (
    artifact?.generator?.name !== 'protos-stdlib-doc-extractor' ||
    typeof artifact.generator.version !== 'string'
  ) {
    throw new Error('Unexpected D064 Standard Library generator identity');
  }
  if (!Array.isArray(artifact.modules) || !Array.isArray(artifact.symbols)) {
    throw new Error('D064 artifact must contain module and symbol arrays');
  }

  const modules = new Map();
  for (const module of artifact.modules) {
    const logical = moduleLogicalName(module);
    const key = module.identity.name;
    if (modules.has(key)) {
      throw new Error(`Duplicate D064 module identity: ${key}`);
    }
    validateDocumentation(module.documentation, key);
    validateSource(module.source);
    modules.set(key, { ...module, logical });
  }

  const symbols = new Set();
  for (const symbol of artifact.symbols) {
    if (
      symbol?.identity?.module?.kind !== 'std' ||
      typeof symbol.identity.module.name !== 'string' ||
      !modules.has(symbol.identity.module.name) ||
      typeof symbol.identity.slot !== 'string' ||
      !symbol.identity.slot
    ) {
      throw new Error('D064 artifact contains an invalid Standard Library symbol identity');
    }
    const key = `${symbol.identity.module.name}::${symbol.identity.slot}`;
    if (symbols.has(key)) {
      throw new Error(`Duplicate D064 symbol identity: ${key}`);
    }
    validateDocumentation(symbol.documentation, key);
    validateSource(symbol.source);
    if (symbol.callable !== null) {
      if (
        !Array.isArray(symbol.callable?.parameters) ||
        !symbol.callable.parameters.every((name) => typeof name === 'string') ||
        !(
          symbol.callable.restParameter === null ||
          typeof symbol.callable.restParameter === 'string'
        )
      ) {
        throw new Error(`Invalid callable facts for ${key}`);
      }
    }
    symbols.add(key);
  }

  return artifact;
}

export function loadProtosLibraryDocumentationArtifact({ cache, lock }) {
  const path = artifactPath(cache);
  if (!existsSync(path)) return null;
  try {
    return validateProtosLibraryDocumentationArtifact(
      JSON.parse(readFileSync(path, 'utf8')),
      lock,
    );
  } catch {
    return null;
  }
}

function commandAvailable(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return !result.error && result.status === 0;
}

function localJava21Available() {
  const result = spawnSync('java', ['-version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) return false;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const match = output.match(/version\s+"(\d+)/);
  return match !== null && Number(match[1]) >= 21;
}

function runLocalProducer(cache) {
  const compile = spawnSync(
    'mvn',
    ['-q', '-DskipTests', 'compile'],
    {
      cwd: cache,
      encoding: 'utf8',
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  if (compile.error) throw compile.error;
  if (compile.status !== 0) {
    throw new Error(
      `Protos documentation producer compilation failed (${compile.status})`,
    );
  }

  const extraction = spawnSync(
    'java',
    ['-cp', 'target/classes', EXTRACTOR_CLASS, cache],
    {
      cwd: cache,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (extraction.error) throw extraction.error;
  if (extraction.status !== 0) {
    if (extraction.stderr) process.stderr.write(extraction.stderr);
    throw new Error(
      `Protos documentation extraction failed (${extraction.status})`,
    );
  }
  return extraction;
}

function runContainerProducer(cache) {
  if (!commandAvailable('docker', ['version'])) {
    throw new Error(
      'The Protos documentation producer requires either local JDK 21 + Maven ' +
        'or Docker for the pinned Maven/JDK toolchain fallback.',
    );
  }

  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const gid = typeof process.getgid === 'function' ? process.getgid() : null;
  const userArgs =
    Number.isInteger(uid) && Number.isInteger(gid)
      ? ['--user', `${uid}:${gid}`, '-e', 'HOME=/tmp']
      : [];

  const shell = [
    'set -eu',
    'command -v git >/dev/null 2>&1 || { echo "Pinned producer image lacks git" >&2; exit 127; }',
    'mvn -q -Dmaven.repo.local=/tmp/.m2 -DskipTests compile 1>&2',
    `java -cp target/classes ${EXTRACTOR_CLASS} /workspace`,
  ].join('; ');

  const extraction = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      ...userArgs,
      '-e',
      'HOME=/tmp',
      '-e',
      'MAVEN_CONFIG=/tmp/.m2',
      '-v',
      `${cache}:/workspace`,
      '-w',
      '/workspace',
      PRODUCER_IMAGE,
      '-lc',
      shell,
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (extraction.error) throw extraction.error;
  if (extraction.status !== 0) {
    if (extraction.stdout) process.stderr.write(extraction.stdout);
    if (extraction.stderr) process.stderr.write(extraction.stderr);
    throw new Error(
      `Containerized Protos documentation producer failed (${extraction.status})`,
    );
  }
  return extraction;
}

export function ensureProtosLibraryDocumentationArtifact({ cache, lock }) {
  const existing = loadProtosLibraryDocumentationArtifact({ cache, lock });
  if (existing) {
    console.log(`PROTOS_LIBRARY_API_ARTIFACT_READY: ${lock.revision}`);
    return existing;
  }

  rmSync(artifactPath(cache), { force: true });
  rmSync(coveragePath(cache), { force: true });

  const useLocal = localJava21Available() && commandAvailable('mvn');
  console.log(
    `PROTOS_LIBRARY_API_PRODUCER_TOOLCHAIN: ${useLocal ? 'local-jdk-maven' : 'docker-fallback'}`,
  );
  const extraction = useLocal
    ? runLocalProducer(cache)
    : runContainerProducer(cache);

  const temporaryArtifact = `${artifactPath(cache)}.tmp-${process.pid}`;
  const temporaryCoverage = `${coveragePath(cache)}.tmp-${process.pid}`;
  rmSync(temporaryArtifact, { force: true });
  rmSync(temporaryCoverage, { force: true });

  try {
    const stdout = extraction.stdout.trim();
    if (!stdout.startsWith('{') || !stdout.endsWith('}')) {
      const preview = stdout.slice(0, 200).replaceAll('\n', '\\n');
      throw new Error(
        `Protos documentation producer stdout is not a clean D064 JSON object: ${preview}`,
      );
    }
    writeFileSync(temporaryArtifact, `${stdout}\n`, 'utf8');
    writeFileSync(temporaryCoverage, extraction.stderr, 'utf8');
    const artifact = validateProtosLibraryDocumentationArtifact(
      JSON.parse(readFileSync(temporaryArtifact, 'utf8')),
      lock,
    );
    renameSync(temporaryArtifact, artifactPath(cache));
    renameSync(temporaryCoverage, coveragePath(cache));
    console.log(`PROTOS_LIBRARY_API_ARTIFACT_MATERIALIZED: ${lock.revision}`);
    return artifact;
  } catch (error) {
    rmSync(temporaryArtifact, { force: true });
    rmSync(temporaryCoverage, { force: true });
    throw error;
  }
}

function symbolsByModule(artifact) {
  const grouped = new Map();
  for (const module of artifact.modules) {
    grouped.set(module.identity.name, []);
  }
  for (const symbol of artifact.symbols) {
    grouped.get(symbol.identity.module.name).push(symbol);
  }
  for (const symbols of grouped.values()) {
    symbols.sort((left, right) =>
      compareText(left.identity.slot, right.identity.slot),
    );
  }
  return grouped;
}

function coverage(artifact) {
  const modulesDocumented = artifact.modules.filter(
    (module) => module.documentation !== null,
  ).length;
  const symbolsDocumented = artifact.symbols.filter(
    (symbol) => symbol.documentation !== null,
  ).length;
  return {
    modulesTotal: artifact.modules.length,
    modulesDocumented,
    modulesUndocumented: artifact.modules.length - modulesDocumented,
    symbolsTotal: artifact.symbols.length,
    symbolsDocumented,
    symbolsUndocumented: artifact.symbols.length - symbolsDocumented,
  };
}

function renderApiIndex({ artifact, lock }) {
  const grouped = symbolsByModule(artifact);
  const stats = coverage(artifact);
  const modules = [...artifact.modules].sort((left, right) =>
    compareText(left.identity.name, right.identity.name),
  );

  const rows = modules
    .map((module) => {
      const symbols = grouped.get(module.identity.name);
      const documentedSymbols = symbols.filter(
        (symbol) => symbol.documentation !== null,
      ).length;
      const moduleStatus =
        module.documentation === null ? 'missing authored docs' : 'documented';
      return (
        `| [${markdownCode(module.identity.name)}](${moduleRoute(module)}) | ` +
        `${symbols.length} | ${moduleStatus} | ${documentedSymbols}/${symbols.length} |`
      );
    })
    .join('\n');

  return `---
title: Standard-library API
description: Exact-revision D064 Standard Library reference generated by the Protos-owned documentation producer.
---

# Standard-library API

> **Protos revision:** \`${lock.revision}\` ·
> **Documentation model:** D064 \`protos-documentation\` v1.0.

This reference is generated from the **Protos-owned extractor in the same exact
Protos revision as the Standard Library source**. The website renders the D064
model; it does not parse Protos source or infer an independent API contract.

:::caution[Observable does not imply stable]
D067 requires every mechanically observable importable \`std:\` module and
top-level slot to remain visible even when authored API documentation is
missing. An undocumented entry is therefore an explicit coverage fact, **not**
a claim that the entry is private, unsupported, stable, unstable, deprecated,
or covered by a compatibility promise.
:::

## Documentation coverage

- Modules: **${stats.modulesDocumented}/${stats.modulesTotal} documented**
  (${stats.modulesUndocumented} missing authored module documentation).
- Top-level slots: **${stats.symbolsDocumented}/${stats.symbolsTotal} documented**
  (${stats.symbolsUndocumented} missing authored symbol documentation).

## Modules

| Module | Observable slots | Module docs | Documented slots |
| --- | ---: | --- | ---: |
${rows}

[Browse the exact implementation source](/reference/standard-library/source/) ·
[Standard library overview](/reference/standard-library/)
`;
}

function renderCallable(callable) {
  if (callable === null) {
    return 'No callable shape is mechanically recorded for this slot.';
  }
  const fixed =
    callable.parameters.length === 0
      ? '_none_'
      : callable.parameters.map(markdownCode).join(', ');
  const rest =
    callable.restParameter === null
      ? '_none_'
      : markdownCode(callable.restParameter);
  return `- **Fixed parameters:** ${fixed}
- **Rest parameter:** ${rest}`;
}

function renderDocumentation(documentation, label) {
  if (documentation === null) {
    return `:::caution[Missing authored API documentation]
${label} is mechanically observable in this exact Standard Library revision,
but has no canonical D062-authored API prose. Do not infer support, stability,
compatibility, privacy, deprecation, or semantic guarantees from that absence.
:::`;
  }
  return documentation;
}

function renderModule({ module, symbols, lock }) {
  const sourceUrl = canonicalBlobUrl(lock, module.source.path, module.source.range);
  const sourceRoute = sourceBrowserRoute(module.source.path);
  const symbolSections = symbols
    .map((symbol) => {
      const symbolUrl = canonicalBlobUrl(lock, symbol.source.path, symbol.source.range);
      return `## ${markdownCode(symbol.identity.slot)}

${renderDocumentation(
  symbol.documentation,
  `The slot ${markdownCode(symbol.identity.slot)}`,
)}

### Mechanical facts

${renderCallable(symbol.callable)}

- **Source occurrence:** [${markdownCode(symbol.source.path)}:${symbol.source.range.start.line}](${symbolUrl})
- **Exact source page:** [open in the source browser](${sourceBrowserRoute(symbol.source.path)})
`;
    })
    .join('\n');

  return `---
title: ${JSON.stringify(module.identity.name)}
description: ${JSON.stringify(`Exact-revision D064 API reference for ${module.identity.name}.`)}
---

# ${markdownCode(module.identity.name)}

> **Canonical occurrence:** [${markdownCode(module.source.path)}](${sourceUrl}) ·
> **Protos revision:** \`${lock.revision}\`.

${renderDocumentation(
  module.documentation,
  `The module ${markdownCode(module.identity.name)}`,
)}

## Observable top-level slots

This page lists the complete mechanically observable top-level slot inventory
required by D067. Authored documentation, when present, is canonical D062 prose;
mechanical presence alone does not create a stability or compatibility promise.

${symbolSections || '_No mechanically observable top-level slots were emitted for this module._'}

[Exact module source](${sourceRoute}) ·
[Standard-library API](/reference/standard-library/api/) ·
[Standard library overview](/reference/standard-library/)
`;
}

function expectedPages({ artifact, lock }) {
  const pages = new Map();
  const grouped = symbolsByModule(artifact);
  const modules = [...artifact.modules].sort((left, right) =>
    compareText(left.identity.name, right.identity.name),
  );

  pages.set('index.md', renderApiIndex({ artifact, lock }));
  for (const module of modules) {
    const logical = moduleLogicalName(module).toLowerCase();
    pages.set(
      `${logical}/index.md`,
      renderModule({
        module,
        symbols: grouped.get(module.identity.name),
        lock,
      }),
    );
  }
  return pages;
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
  return files.sort(compareText);
}

export function protosLibraryApiMatches({ root, lock, artifact }) {
  let pages;
  try {
    validateProtosLibraryDocumentationArtifact(artifact, lock);
    pages = expectedPages({ artifact, lock });
  } catch {
    return false;
  }

  const outputRoot = join(
    root,
    'src/content/docs/reference/standard-library/api',
  );
  const actualFiles = collectGeneratedMarkdown(outputRoot);
  const expectedFiles = [...pages.keys()].sort(compareText);
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    return false;
  }

  for (const [relativePath, content] of pages) {
    const output = join(outputRoot, ...relativePath.split('/'));
    if (!existsSync(output) || readFileSync(output, 'utf8') !== content) {
      return false;
    }
  }
  return true;
}

export function materializeProtosLibraryApi({ root, lock, artifact }) {
  validateProtosLibraryDocumentationArtifact(artifact, lock);
  const outputRoot = join(
    root,
    'src/content/docs/reference/standard-library/api',
  );
  const pages = expectedPages({ artifact, lock });

  rmSync(outputRoot, { recursive: true, force: true });

  for (const [relativePath, content] of pages) {
    const output = join(outputRoot, ...relativePath.split('/'));
    mkdirSync(dirname(output), { recursive: true });
    const temporary = `${output}.tmp-${process.pid}`;
    rmSync(temporary, { force: true });
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, output);
  }

  if (!protosLibraryApiMatches({ root, lock, artifact })) {
    throw new Error(
      `Generated Protos library API reference does not match locked revision ${lock.revision}`,
    );
  }

  const stats = coverage(artifact);
  console.log(
    `PROTOS_LIBRARY_API_MATERIALIZED: ${lock.revision} ` +
      `modules=${stats.modulesTotal} symbols=${stats.symbolsTotal} ` +
      `moduleDocs=${stats.modulesDocumented} symbolDocs=${stats.symbolsDocumented}`,
  );
}
