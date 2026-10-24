import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyLiveNews,
  refreshLiveNews,
} from '../src/scripts/live-news.js';

function element(tagName) {
  return {
    tagName,
    className: '',
    textContent: '',
    href: '',
    rel: '',
    children: [],
    append(...items) {
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = items;
    },
  };
}

function page() {
  const cards = element('div');
  const status = element('p');

  status.textContent = 'See GitHub Discussions';

  return {
    cards,
    status,
    querySelector(selector) {
      if (selector === '[data-live-news="cards"]') return cards;
      if (selector === '[data-live-news="status"]') return status;
      return null;
    },
    createElement(tagName) {
      return element(tagName);
    },
  };
}

function entry(number, title = `Announcement ${number}`) {
  return {
    title,
    date: '2026-10-22',
    href:
      `https://github.com/guillermomolina/protos/discussions/${number}`,
    summary: 'Published in GitHub Discussions.',
  };
}

function payload(entries = [entry(954)], state = 'fresh') {
  return {
    schemaVersion: 1,
    state,
    entries,
  };
}

test('homepage uses dynamic news without generated news JSON', () => {
  const source = readFileSync('src/pages/index.astro', 'utf8');

  assert.doesNotMatch(source, /protos-news\.json/);
  assert.doesNotMatch(source, /latestNews\.map/);
  assert.match(source, /data-live-news="cards"/);
  assert.match(source, /data-live-news="status"/);
  assert.match(source, /refreshLiveNews\(document, fetch\)/);
});

test('news archive points to canonical Announcements', () => {
  const source = readFileSync('src/pages/index.astro', 'utf8');

  assert.match(
    source,
    /https:\/\/github\.com\/guillermomolina\/protos\/discussions\/categories\/announcements/,
  );

  assert.doesNotMatch(
    source,
    /href="\/community\/news\/"/,
  );
});

test('renders valid canonical announcements', () => {
  const document = page();

  const success = applyLiveNews(
    document,
    payload([
      entry(954, 'Protos 0.3.398 is now available!'),
      entry(950, 'A New Way to Express Control Flow'),
    ]),
  );

  assert.equal(success, true);
  assert.equal(document.cards.children.length, 2);
  assert.equal(document.status.textContent, '');

  const first = document.cards.children[0];

  assert.equal(first.className, 'news-card');
  assert.equal(first.children[0].textContent, '2026-10-22');
  assert.equal(
    first.children[1].children[0].textContent,
    'Protos 0.3.398 is now available!',
  );
  assert.equal(
    first.children[1].children[0].href,
    'https://github.com/guillermomolina/protos/discussions/954',
  );
});

test('shows only the three latest entries received', () => {
  const document = page();

  assert.equal(
    applyLiveNews(
      document,
      payload([
        entry(954),
        entry(950),
        entry(925),
        entry(900),
      ]),
    ),
    true,
  );

  assert.equal(document.cards.children.length, 3);
});

test('accepts last known good stale announcements', () => {
  const document = page();

  assert.equal(
    applyLiveNews(
      document,
      payload([entry(954)], 'stale'),
    ),
    true,
  );

  assert.equal(document.cards.children.length, 1);
});

test('rejects substituted external URLs', () => {
  const document = page();
  const news = entry(954);

  news.href = 'https://example.invalid/malicious';

  assert.equal(
    applyLiveNews(document, payload([news])),
    false,
  );

  assert.equal(document.cards.children.length, 0);
  assert.notEqual(document.status.textContent, '');
});

test('rejects query-string link substitution', () => {
  const document = page();
  const news = entry(954);

  news.href += '?redirect=https://example.invalid/';

  assert.equal(
    applyLiveNews(document, payload([news])),
    false,
  );
});

test('rejects impossible publication dates', () => {
  const document = page();
  const news = entry(954);

  news.date = '2026-02-31';

  assert.equal(
    applyLiveNews(document, payload([news])),
    false,
  );
});

test('never interprets announcement titles as HTML', () => {
  const document = page();
  const dangerous = '<img src=x onerror=alert(1)>';

  assert.equal(
    applyLiveNews(
      document,
      payload([entry(954, dangerous)]),
    ),
    true,
  );

  const link = document.cards.children[0]
    .children[1].children[0];

  assert.equal(link.textContent, dangerous);
  assert.equal(link.children.length, 0);

  const client = readFileSync(
    'src/scripts/live-news.js',
    'utf8',
  );

  assert.doesNotMatch(client, /\binnerHTML\b/);
});

test('preserves the fallback for empty news', () => {
  const document = page();

  assert.equal(
    applyLiveNews(document, payload([])),
    false,
  );

  assert.equal(document.cards.children.length, 0);
  assert.notEqual(document.status.textContent, '');
});

test('preserves the fallback on upstream failure', async () => {
  const document = page();

  const success = await refreshLiveNews(
    document,
    async () => ({
      ok: false,
      status: 503,
    }),
  );

  assert.equal(success, false);
  assert.equal(document.cards.children.length, 0);
});

test('fetches only the same-origin endpoint', async () => {
  const document = page();
  let calls = 0;

  const success = await refreshLiveNews(
    document,
    async (url, options) => {
      calls += 1;

      assert.equal(url, '/api/live/news');
      assert.equal(options.method, 'GET');
      assert.equal(options.cache, 'no-store');

      return {
        ok: true,
        json: async () => payload([entry(954)]),
      };
    },
  );

  assert.equal(success, true);
  assert.equal(calls, 1);
  assert.equal(document.cards.children.length, 1);
});

test('preserves the fallback on network failure', async () => {
  const document = page();

  const success = await refreshLiveNews(
    document,
    async () => {
      throw new Error('Network unavailable');
    },
  );

  assert.equal(success, false);
  assert.equal(document.cards.children.length, 0);
});
