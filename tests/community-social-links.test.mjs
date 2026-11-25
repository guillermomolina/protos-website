import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REDDIT = 'https://www.reddit.com/r/Protos/';
const X = 'https://x.com/ProtosLang';
const GITHUB = 'https://github.com/guillermomolina/protos';

function socialBlock() {
  const config = readFileSync('astro.config.mjs', 'utf8');
  const match = config.match(/social:\s*\[([\s\S]*?)\n\s*\],/);
  assert.ok(match, 'Starlight social configuration must exist');
  return match[1];
}

function socialEntry(href) {
  const entries = socialBlock().split(/\},/);
  const entry = entries.find((candidate) => candidate.includes(`href: '${href}'`));
  assert.ok(entry, `social entry for ${href} must exist`);
  return entry;
}

function footer() {
  const source = readFileSync('src/pages/index.astro', 'utf8');
  const match = source.match(/<footer>([\s\S]*?)<\/footer>/);
  assert.ok(match, 'homepage footer must exist');
  return match[1];
}

test('Starlight social navigation preserves the GitHub entry', () => {
  const entry = socialEntry(GITHUB);
  assert.match(entry, /icon: 'github'/);
  assert.match(entry, /label: 'GitHub'/);
});

test('Starlight social navigation includes the official Reddit and X URLs', () => {
  const block = socialBlock();
  assert.ok(block.includes(`href: '${REDDIT}'`));
  assert.ok(block.includes(`href: '${X}'`));
});

test('Starlight social entries have accessible labels', () => {
  assert.match(socialEntry(REDDIT), /label: 'Reddit — r\/Protos'/);
  assert.match(socialEntry(X), /label: 'X — @ProtosLang'/);
});

test('Starlight social entries use supported built-in icon identifiers', () => {
  assert.match(socialEntry(REDDIT), /icon: 'reddit'/);
  assert.match(socialEntry(X), /icon: 'x\.com'/);
});

test('homepage defines the exact Reddit and X URLs', () => {
  const source = readFileSync('src/pages/index.astro', 'utf8');
  assert.ok(source.includes(`const redditCommunity = '${REDDIT}';`));
  assert.ok(source.includes(`const xProfile = '${X}';`));
});

test('homepage footer links GitHub, Reddit and X through URL constants', () => {
  const html = footer();
  assert.match(html, /<a href=\{canonicalRepository\}>GitHub<\/a>/);
  assert.match(html, /<a href=\{redditCommunity\}[^>]*>Reddit<\/a>/);
  assert.match(html, /<a href=\{xProfile\}[^>]*>X<\/a>/);
});

test('homepage footer navigation and social links have accessible labels', () => {
  const html = footer();
  assert.match(html, /<nav class="footer-social-links" aria-label="Protos community links">/);
  assert.match(html, /<a href=\{redditCommunity\} aria-label="Reddit — r\/Protos">/);
  assert.match(html, /<a href=\{xProfile\} aria-label="X — @ProtosLang">/);
});

test('homepage footer preserves existing content', () => {
  const html = footer();
  assert.match(html, /class="shell footer-inner"/);
  assert.match(html, /Protos is experimental\. The canonical specification and project/);
});

test('footer social links use wrapping flex layout with visible focus', () => {
  const css = readFileSync('src/styles/home.css', 'utf8');
  const layout = css.match(/\.footer-social-links\s*\{([^}]*)\}/);
  assert.ok(layout, '.footer-social-links rule must exist');
  assert.match(layout[1], /display:\s*flex;/);
  assert.match(layout[1], /flex-wrap:\s*wrap;/);
  const focus = css.match(/\.footer-social-links a:focus-visible\s*\{([^}]*)\}/);
  assert.ok(focus, 'focus-visible rule must exist');
  assert.match(focus[1], /outline:\s*2px solid currentColor;/);
});

test('community page links the official social channels', () => {
  const page = readFileSync('src/content/docs/community/index.md', 'utf8');
  assert.ok(page.includes(REDDIT));
  assert.ok(page.includes(X));
  assert.ok(page.includes('r/Protos'));
  assert.ok(page.includes('@ProtosLang'));
});

test('community page preserves canonical news authority', () => {
  const page = readFileSync('src/content/docs/community/index.md', 'utf8');
  assert.ok(
    page.includes('https://github.com/guillermomolina/protos/discussions/categories/announcements'),
  );
  assert.match(page, /GitHub Discussions is\s+the canonical news archive/);
});

test('README includes linked Reddit and X badges with alternative text', () => {
  const readme = readFileSync('README.md', 'utf8');
  assert.ok(
    readme.includes(
      `[![Reddit: r/Protos](https://img.shields.io/badge/Reddit-r%2FProtos-FF4500?logo=reddit&logoColor=white)](${REDDIT})`,
    ),
  );
  assert.ok(
    readme.includes(
      `[![X: @ProtosLang](https://img.shields.io/badge/X-%40ProtosLang-000000?logo=x&logoColor=white)](${X})`,
    ),
  );
});
