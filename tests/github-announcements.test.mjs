import test from 'node:test';
import assert from 'node:assert/strict';

import announcements from '../server/github-announcements-core.js';

const { normalizeAnnouncementsDocument } = announcements;

const NS = 'http://www.w3.org/2005/Atom';

function node(name, value = '', attributes = {}, tags = []) {
  const result = {
    $name: name,
    $ns: NS,
    $text: value,
    $tags: tags,
  };

  for (const [key, content] of Object.entries(attributes)) {
    result[`$attr$${key}`] = content;
  }

  return result;
}

function entry(number, date, title = `News ${number}`) {
  return node('entry', '', {}, [
    node('title', title),
    node('published', date),
    node('link', '', {
      rel: 'alternate',
      href:
        `https://github.com/guillermomolina/protos/discussions/${number}`,
    }),
    node(
      'content',
      '&lt;p&gt;Announcement content&lt;/p&gt;',
    ),
  ]);
}

function feed(entries) {
  return {
    feed: node('feed', '', {}, entries),
  };
}

test('normalizes published announcements', () => {
  const result = normalizeAnnouncementsDocument(feed([
    entry(100, '2026-10-23T00:00:00Z'),
  ]));

  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'News 100');
  assert.equal(result[0].date, '2026-10-23');
  assert.equal(
    result[0].href,
    'https://github.com/guillermomolina/protos/discussions/100',
  );
});

test('sorts announcements newest first', () => {
  const result = normalizeAnnouncementsDocument(feed([
    entry(101, '2026-10-01T00:00:00Z'),
    entry(102, '2026-10-23T00:00:00Z'),
  ]));

  assert.equal(result[0].title, 'News 102');
  assert.equal(result[1].title, 'News 101');
});

test('rejects external discussion URLs', () => {
  const bad = entry(103, '2026-10-23T00:00:00Z');

  bad.$tags[2].$attr$href =
    'https://example.invalid/discussions/103';

  assert.deepEqual(
    normalizeAnnouncementsDocument(feed([bad])),
    [],
  );
});

test('rejects discussion URLs from another repository', () => {
  const bad = entry(104, '2026-10-23T00:00:00Z');

  bad.$tags[2].$attr$href =
    'https://github.com/other/repository/discussions/104';

  assert.deepEqual(
    normalizeAnnouncementsDocument(feed([bad])),
    [],
  );
});

test('rejects invalid publication dates', () => {
  assert.deepEqual(
    normalizeAnnouncementsDocument(feed([
      entry(105, 'invalid-date'),
    ])),
    [],
  );
});

test('eliminates duplicate announcements', () => {
  const result = normalizeAnnouncementsDocument(feed([
    entry(106, '2026-10-20T00:00:00Z'),
    entry(106, '2026-10-20T00:00:00Z'),
  ]));

  assert.equal(result.length, 1);
});

test('rejects a document without the Atom namespace', () => {
  const document = feed([]);

  document.feed.$ns = 'https://example.invalid/';

  assert.throws(
    () => normalizeAnnouncementsDocument(document),
    /Invalid Atom feed identity/,
  );
});

test('limits the visible news collection', () => {
  const entries = [];

  for (let number = 1; number <= 30; number += 1) {
    entries.push(
      entry(number, '2026-10-23T00:00:00Z'),
    );
  }

  const result = normalizeAnnouncementsDocument(feed(entries));

  assert.equal(result.length, 20);
});

test('does not accept more than 100 Atom entries', () => {
  const entries = [];

  for (let number = 1; number <= 101; number += 1) {
    entries.push(
      entry(number, '2026-10-23T00:00:00Z'),
    );
  }

  assert.throws(
    () => normalizeAnnouncementsDocument(feed(entries)),
    /exceeds entry limit/,
  );
});

test('returns JSON-safe plain-text fields', () => {
  const document = feed([
    entry(107, '2026-10-23T00:00:00Z', 'Project update'),
  ]);

  const result = normalizeAnnouncementsDocument(document);

  assert.equal(result.length, 1);
  assert.deepEqual(
    Object.keys(result[0]),
    ['title', 'href', 'date', 'summary'],
  );
  assert.equal(typeof result[0].summary, 'string');
});

test('accepts an empty valid feed', () => {
  assert.deepEqual(
    normalizeAnnouncementsDocument(feed([])),
    [],
  );
});


test('accepts the real njs XMLDoc root and GitHub UTC format', () => {
  const item = entry(
    954,
    '2026-10-22T14:05:55+00:00',
    '\n      Protos 0.3.398 is now available!\n    ',
  );

  const document = {
    $root: node('feed', '', {}, [
      node('title', 'Protos Announcements'),
      item,
    ]),
  };

  const result = normalizeAnnouncementsDocument(document);

  assert.equal(result.length, 1);
  assert.equal(
    result[0].title,
    'Protos 0.3.398 is now available!',
  );
  assert.equal(result[0].date, '2026-10-22');
  assert.equal(
    result[0].href,
    'https://github.com/guillermomolina/protos/discussions/954',
  );
});

test('converts XML string wrappers into primitive values', () => {
  const item = entry(
    950,
    '2026-10-22T07:55:41+00:00',
  );

  for (const child of item.$tags) {
    child.$name = new String(child.$name);
    child.$ns = new String(child.$ns);

    if (child.$name == 'title' ||
        child.$name == 'published') {
      child.$text = new String(child.$text);
    }

    if (child.$name == 'link') {
      child.$attr$rel = new String(child.$attr$rel);
      child.$attr$href = new String(child.$attr$href);
    }
  }

  const result = normalizeAnnouncementsDocument(
    feed([item]),
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'News 950');
});
