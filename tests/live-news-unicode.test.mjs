import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLiveNews } from '../src/scripts/live-news.js';

function entry(overrides = {}) {
  return {
    title: 'Protos announcement',
    summary: 'An official project announcement.',
    href: 'https://github.com/guillermomolina/protos/discussions/950',
    date: '2026-10-22',
    ...overrides,
  };
}

function payload(entries) {
  return {
    schemaVersion: 1,
    state: 'fresh',
    entries,
  };
}

function documentProbe() {
  const cards = {
    children: [],
    replaceChildren(...items) {
      this.children = items;
    },
  };

  const status = {
    textContent: 'Latest announcements are available on GitHub Discussions.',
  };

  const documentRoot = {
    querySelector(selector) {
      if (selector === '[data-live-news="cards"]') return cards;
      if (selector === '[data-live-news="status"]') return status;
      return null;
    },
    createElement(tagName) {
      return {
        tagName,
        children: [],
        append(...items) {
          this.children.push(...items);
        },
      };
    },
  };

  return { documentRoot, cards, status };
}

test('accepts 240 Unicode code points even when UTF-16 length is 241', () => {
  const summary = 'x'.repeat(239) + '🚀';

  assert.equal(summary.length, 241);
  assert.equal(Array.from(summary).length, 240);

  const entries = Array.from({ length: 16 }, (_, index) =>
    entry({
      href: `https://github.com/guillermomolina/protos/discussions/${950 + index}`,
      summary: [1, 10, 11, 13].includes(index)
        ? summary
        : 'Valid announcement.',
    }),
  );

  const { documentRoot, cards, status } = documentProbe();

  assert.equal(applyLiveNews(documentRoot, payload(entries)), true);
  assert.equal(cards.children.length, 3);
  assert.equal(cards.children[1].children[2].textContent, summary);
  assert.equal(status.textContent, '');
});

test('accepts a 200-code-point title containing an emoji', () => {
  const title = 'x'.repeat(199) + '🚀';
  assert.equal(title.length, 201);

  const { documentRoot, cards } = documentProbe();

  assert.equal(
    applyLiveNews(documentRoot, payload([entry({ title })])),
    true,
  );
  assert.equal(cards.children.length, 1);
});

test('rejects summaries longer than 240 Unicode code points', () => {
  const { documentRoot, cards, status } = documentProbe();

  assert.equal(
    applyLiveNews(
      documentRoot,
      payload([entry({ summary: 'x'.repeat(241) })]),
    ),
    false,
  );

  assert.equal(cards.children.length, 0);
  assert.match(status.textContent, /GitHub Discussions/);
});

test('rejects titles longer than 200 Unicode code points', () => {
  const { documentRoot, cards } = documentProbe();

  assert.equal(
    applyLiveNews(
      documentRoot,
      payload([entry({ title: 'x'.repeat(201) })]),
    ),
    false,
  );

  assert.equal(cards.children.length, 0);
});

test('preserves canonical GitHub URL validation', () => {
  const { documentRoot, cards } = documentProbe();

  assert.equal(
    applyLiveNews(
      documentRoot,
      payload([entry({ href: 'https://example.com/untrusted' })]),
    ),
    false,
  );

  assert.equal(cards.children.length, 0);
});
