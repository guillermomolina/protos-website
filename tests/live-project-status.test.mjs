import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  validateProjectPayload,
} from '../src/scripts/live-project-status.js';

const date = '2026-10-23T04:10:00Z';

const issue = (number = 31, extra = {}) => ({
  number,
  title: 'Valid issue',
  updatedAt: date,
  href: `https://github.com/guillermomolina/protos/issues/${number}`,
  ...extra,
});

const run = (id = 42, extra = {}) => ({
  id,
  name: 'CI',
  status: 'completed',
  conclusion: 'success',
  branch: 'main',
  headSha: 'a'.repeat(40),
  createdAt: date,
  href: `https://github.com/guillermomolina/protos/actions/runs/${id}`,
  ...extra,
});

const payload = (kind, entries, state = 'fresh') => ({
  schemaVersion: 1,
  kind,
  scope: kind === 'issues'
    ? 'recent-open-issues'
    : 'recent-workflow-runs',
  sampled: true,
  state,
  entries,
});

test('validates fresh and stale issues', () => {
  for (const state of ['fresh', 'stale']) {
    const data = payload('issues', [issue()], state);
    assert.equal(validateProjectPayload(data, 'issues'), data);
  }
});

test('workflow runs do not imply test results', () => {
  const data = payload('actions', [run()]);
  assert.equal(validateProjectPayload(data, 'actions'), data);
  assert.equal('testsPassed' in data, false);
});

test('rejects external links and misleading scope', () => {
  assert.throws(() => validateProjectPayload(
    payload('issues', [
      issue(31, { href: 'https://example.com/' }),
    ]), 'issues',
  ));

  assert.throws(() => validateProjectPayload({
    ...payload('issues', [issue()]),
    scope: 'all-open-issues',
  }, 'issues'));
});

test('enforces sample and Unicode length limits', () => {
  assert.throws(() => validateProjectPayload(
    payload('issues', Array.from(
      { length: 7 },
      (_, i) => issue(i + 1),
    )), 'issues',
  ));

  assert.throws(() => validateProjectPayload(
    payload('issues', [
      issue(1, { title: 'x'.repeat(200) + '🚀' }),
    ]), 'issues',
  ));

  assert.equal(
    validateProjectPayload(
      payload('issues', [
        issue(1, { title: 'x'.repeat(199) + '🚀' }),
      ]), 'issues',
    ).entries.length,
    1,
  );
});

test('rejects inconsistent workflow states and identifiers', () => {
  assert.throws(() => validateProjectPayload(
    payload('actions', [
      run(1, { status: 'queued', conclusion: 'success' }),
    ]), 'actions',
  ));

  assert.throws(() => validateProjectPayload(
    payload('actions', [
      run(1, { id: '1' }),
    ]), 'actions',
  ));
});

test('rejects unavailable state and invalid timestamps', () => {
  assert.throws(() => validateProjectPayload(
    payload('issues', [], 'unavailable'),
    'issues',
  ));

  assert.throws(() => validateProjectPayload(
    payload('issues', [
      issue(1, { updatedAt: 'yesterday' }),
    ]), 'issues',
  ));
});

test('homepage wires two regions with GitHub fallbacks', () => {
  const html = readFileSync('src/pages/index.astro', 'utf8');

  for (const kind of ['issues', 'actions']) {
    assert.match(
      html,
      new RegExp(`data-project-status-list="${kind}"`),
    );
    assert.match(
      html,
      new RegExp(`data-project-status-state="${kind}"`),
    );
  }

  assert.match(
    html,
    /github\.com\/guillermomolina\/protos\/issues/,
  );

  assert.match(
    html,
    /github\.com\/guillermomolina\/protos\/actions/,
  );

  assert.match(
    html,
    /import ['"]\.\.\/scripts\/live-project-status\.js['"]/,
  );
});

test('remote text is never inserted as HTML', () => {
  const source = readFileSync(
    'src/scripts/live-project-status.js',
    'utf8',
  );

  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /insertAdjacentHTML\s*\(/);
  assert.match(source, /\.textContent\s*=/);
  assert.match(source, /Promise\.allSettled/);
});
