import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from '../src/scripts/live-docs-markdown.js';

const catalog = {
  revision: 'a'.repeat(40),
  entries: [
    { family: 'spec', path: 'spec/AGENTS.md' },
    { family: 'guide', path: 'docs/guide/intro.md' }
  ]
};
const entry = catalog.entries[0];

test('renders Markdown, GFM tables and inert Protos fences', () => {
  const html = renderMarkdown([
    '# Heading', '', '**Strong** and *emphasis*', '',
    '| A | B |', '| - | - |', '| 1 | 2 |', '',
    '```protos', 'value: 1', '```'
  ].join('\n'), catalog, entry);

  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<strong>Strong<\/strong>/);
  assert.match(html, /<table>/);
  assert.match(html, /class="language-protos"/);
  assert.match(html, /value: 1/);
});

test('keeps raw HTML inert and suppresses embedded images', () => {
  const html = renderMarkdown([
    '<script>alert(1)</script>',
    '<img src="x" onerror="alert(1)">',
    '![tracking](https://example.com/pixel.png)',
    '[bad](javascript:alert(1))'
  ].join('\n\n'), catalog, entry);

  assert.doesNotMatch(html, /<(?:script|img)\b/i);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /tracking/);
});

test('rewrites admitted relative document links', () => {
  const html = renderMarkdown(
    '[Guide](../docs/guide/intro.md#start)', catalog, entry
  );

  assert.match(html, /href="\/docs\/live\/\?family=guide/);
  assert.match(html, /path=docs%2Fguide%2Fintro.md#start/);
});

test('rejects unlisted local targets and query overrides', () => {
  const html = renderMarkdown(
    '[API](../api/private) [Query](AGENTS.md?ref=main)',
    catalog, entry
  );

  assert.doesNotMatch(html, /<a\s/i);
});

test('allows safe external protocols and neutralizes references', () => {
  const html = renderMarkdown([
    '[Official](https://example.com/docs)',
    '[unsafe][bad]',
    '',
    '[bad]: data:text/html,broken'
  ].join('\n'), catalog, entry);

  assert.match(html, /href="https:\/\/example.com\/docs"/);
  assert.doesNotMatch(html, /href="data:/);
});

test('rejects input outside the admitted catalog', () => {
  assert.throws(() => renderMarkdown(
    '# A', catalog, { family: 'spec', path: 'spec/unknown.md' }
  ));

  assert.throws(() =>
    renderMarkdown('a'.repeat(131073), catalog, entry)
  );
});
