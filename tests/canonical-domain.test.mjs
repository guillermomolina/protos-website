import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const origin = 'https://www.protoslang.com';
const server = 'https://stats.guillermomolina.com/script.js';
const websiteId = '16bfc4d7-f72e-488e-b153-3466acf8d1c3';
const obsoleteHost = ['protos', 'guillermomolina', 'com'].join('.');
const read = (path) => readFileSync(path, 'utf8');
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test('canonical origin and all existing Umami integrations preserve identity', () => {
  const config = read('astro.config.mjs');
  assert.ok(config.includes(`site: '${origin}'`));
  for (const path of ['astro.config.mjs', 'src/pages/index.astro', 'src/pages/docs/live.astro']) {
    const source = read(path);
    assert.equal(source.split(server).length - 1, 1, path);
    assert.equal(source.split(websiteId).length - 1, 1, path);
    assert.match(source, /data-domains['"]?\s*[:=]\s*['"]www\.protoslang\.com['"]/);
  }
  const homepage = read('src/pages/index.astro');
  assert.ok(homepage.includes("new URL('/', Astro.site)"));
  assert.ok(homepage.includes("new URL('/icon-512x512.png', Astro.site)"));
});

test('website-owned active sources contain no obsolete hostname', () => {
  const paths = [
    'astro.config.mjs', 'README.md', 'Dockerfile', 'compose.yaml', 'package.json',
    ...files('src'), ...files('public'), ...files('scripts'), ...files('server'),
    ...files('.github'),
  ];
  for (const path of paths) {
    assert.ok(!read(path).includes(obsoleteHost), path);
  }
});

test('production serving and publication retain their existing contracts', () => {
  assert.match(read('Dockerfile'), /FROM --platform=\$BUILDPLATFORM/);
  assert.match(read('Dockerfile'), /EXPOSE 8080/);
  const nginx = read('server/nginx/default.conf.template');
  assert.match(nginx, /listen 8080;/);
  assert.doesNotMatch(nginx, /return 30[1278]/);
  const workflow = read('.github/workflows/publish-image.yml');
  assert.ok(workflow.includes('IMAGE_NAME: ghcr.io/${{ github.repository }}'));
  assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/);
  assert.match(workflow, /type=sha,format=long,prefix=sha-/);
  assert.match(workflow, /packages: write/);
  assert.ok(workflow.includes('password: ${{ github.token }}'));
  assert.match(workflow, /ANONYMOUS_GHCR_READ: PASS/);
});

test('built HTML, sitemap and existing robots declarations use the canonical origin', {
  skip: !existsSync('dist/index.html') ? 'Run npm run build before generated-output validation' : false,
}, () => {
  const output = files('dist');
  const html = output.filter((path) => path.endsWith('.html'));
  for (const page of ['index.html', 'docs/live/index.html', 'learn/index.html', 'reference/index.html', 'design/index.html', 'community/index.html']) {
    assert.ok(output.includes(join('dist', page)), page);
  }
  for (const path of html) {
    const source = read(path);
    assert.ok(!source.includes(obsoleteHost), path);
    const scripts = source.match(/<script\b[^>]*>/g) ?? [];
    const trackers = scripts.filter((tag) => tag.includes(server));
    assert.equal(trackers.length, 1, path);
    assert.ok(trackers[0].includes(`data-website-id="${websiteId}"`), path);
    assert.ok(trackers[0].includes('data-domains="www.protoslang.com"'), path);
    for (const tag of source.match(/<(?:link|meta)\b[^>]*>/g) ?? []) {
      if (/rel="canonical"|property="og:url"/.test(tag)) {
        assert.ok(tag.includes(`${origin}/`), `${path}: ${tag}`);
      }
    }
    if (path === join('dist', 'index.html')) {
      assert.ok(source.includes(`href="${origin}/"`));
      assert.ok(source.includes(`content="${origin}/icon-512x512.png"`));
    }
  }
  const sitemaps = output.filter((path) => /sitemap[^/]*\.xml$/.test(path));
  assert.ok(sitemaps.length > 0, 'existing Starlight sitemap output');
  let entries = 0;
  for (const path of sitemaps) {
    for (const match of read(path).matchAll(/<loc>(.*?)<\/loc>/g)) {
      assert.equal(new URL(match[1]).origin, origin, path);
      entries++;
    }
  }
  assert.ok(entries > 0);
  if (existsSync('dist/robots.txt')) {
    for (const match of read('dist/robots.txt').matchAll(/^Sitemap:\s*(\S+)/gmi)) {
      assert.equal(new URL(match[1]).origin, origin);
      assert.ok(existsSync(join('dist', new URL(match[1]).pathname)));
    }
  }
});
