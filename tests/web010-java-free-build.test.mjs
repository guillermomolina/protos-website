import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(name, 'utf8');

test('WEB010 build and devcontainer do not use Java, Maven or apt in dev', () => {
  const dev = read('.devcontainer/Dockerfile');
  const docker = read('Dockerfile');
  for (const source of [dev, docker]) {
    assert.doesNotMatch(source, /\bJAVA_HOME\b|\bMAVEN_HOME\b|eclipse-temurin|maven:/);
  }
  assert.doesNotMatch(dev, /apt-get/);
  assert.match(dev, /node:22\.23\.2-bookworm/);
  assert.match(docker, / AS production/);
  assert.match(docker, /COPY --from=build/);
});

test('WEB010 dev/build never invokes static Protos documentation producer', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const name of ['prepare:protos', 'predev', 'prebuild']) {
    assert.ok(scripts[name]);
    assert.doesNotMatch(scripts[name], /scripts\/prepare-protos\.mjs/);
  }
  assert.match(scripts['prepare:protos'], /retire-protos-static\.mjs/);
  assert.match(scripts['prepare:protos'], /prepare-vscode-grammar\.mjs/);
  assert.match(scripts['source:check'], /retire-protos-static\.mjs --check/);
  assert.doesNotMatch(read('compose.yaml'), /PROTOS_SOURCE_CACHE/);
  assert.equal(Object.hasOwn(scripts, 'source:update'), false);
});

test('WEB010 curated branding survives static Protos page retirement', () => {
  const script = read('scripts/retire-protos-static.mjs');
  assert.doesNotMatch(script, /public\/protos-branding/);
  assert.doesNotMatch(script, /rmSync\(join\(root, 'src\/content\/docs'\)/);
  for (const name of ['protos-logo.png', 'protos-symbol.png']) {
    const asset = readFileSync(`public/protos-branding/${name}`);
    assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
});
