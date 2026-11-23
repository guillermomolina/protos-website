import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync,
  writeFileSync, existsSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  materializeProtosGuide,
  protosGuideMatchesSource,
} from '../scripts/materialize-protos-guide.mjs';

test('WEB010 materializes canonical first-program.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'web010-guide-'));
  const cache = join(root, 'canonical');
  const sourceDir = join(cache, 'docs/guide');
  const lock = { revision: 'a'.repeat(40) };

  try {
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      join(sourceDir, '00-try-protos.md'),
      '# Try Protos\n\nInstall Protos.\n',
    );
    writeFileSync(
      join(sourceDir, 'first-program.md'),
      '# Your first program\n\nWrite a program.\n',
    );

    materializeProtosGuide({ root, cache, lock });

    const output = join(
      root, 'src/content/docs/learn/guide/first-program.md',
    );

    assert.equal(existsSync(output), true);
    assert.match(
      readFileSync(output, 'utf8'),
      /Your first program/,
    );
    assert.equal(
      protosGuideMatchesSource({ root, cache, lock }),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('WEB010 active build is Java-free and documents are dynamic', async () => {
  const { readFileSync } = await import('node:fs');
  const { default: assert } = await import('node:assert/strict');
  const docker = readFileSync('Dockerfile', 'utf8');
  const dev = readFileSync('.devcontainer/Dockerfile', 'utf8');
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const input of [docker, dev]) {
    assert.doesNotMatch(input, /eclipse-temurin|\bmaven:|\bJAVA_HOME\b/);
  }
  assert.doesNotMatch(packageJson.scripts['prepare:protos'], /prepare-protos\.mjs/);
  assert.match(packageJson.scripts['prepare:protos'], /retire-protos-static\.mjs/);
});
