import test from 'node:test';
import assert from 'node:assert/strict';

import projectService from '../server/github-project-status-service.js';

const { serveIssues, serveActions } = projectService;

const updated = '2026-10-23T04:10:00Z';

const issue = (number) => ({
  number,
  state: 'open',
  title: `Issue ${number}`,
  html_url:
    `https://github.com/guillermomolina/protos/issues/${number}`,
  updated_at: updated,
});

const run = (id) => ({
  id,
  name: 'CI',
  status: 'completed',
  conclusion: 'success',
  html_url:
    `https://github.com/guillermomolina/protos/actions/runs/${id}`,
  created_at: updated,
  head_branch: 'main',
  head_sha: 'a'.repeat(40),
});

function cache() {
  const values = new Map();
  const ttl = new Map();

  return {
    values,
    ttl,
    get(key) {
      return values.get(key);
    },
    set(key, value, time) {
      values.set(key, value);
      ttl.set(key, time);
      return true;
    },
    add(key, value, time) {
      if (values.has(key)) return false;
      values.set(key, value);
      ttl.set(key, time);
      return true;
    },
    delete(key) {
      values.delete(key);
      ttl.delete(key);
    },
  };
}

function request(method = 'GET') {
  return {
    method,
    headersOut: {},
    code: null,
    body: null,
    return(code, raw) {
      this.code = code;
      this.body = JSON.parse(raw);
    },
  };
}

function fetchJSON(data, records = []) {
  return async (url, options) => {
    records.push({ url, options });

    return {
      status: 200,
      async text() {
        return JSON.stringify(data);
      },
    };
  };
}

test('Issues MISS then HIT; fixed URL, TTL and sample', async () => {
  const c = cache();
  const requests = [];
  const deps = {
    cache: c,
    fetcher: fetchJSON([issue(1)], requests),
  };

  const first = request();
  const second = request();

  await serveIssues(first, deps);
  await serveIssues(second, deps);

  assert.equal(first.code, 200);
  assert.equal(second.code, 200);

  assert.equal(first.headersOut['X-Protos-Cache'], 'MISS');
  assert.equal(second.headersOut['X-Protos-Cache'], 'HIT');

  assert.equal(first.body.entries[0].number, 1);
  assert.equal(first.body.sampled, true);
  assert.equal(first.headersOut['Cache-Control'], 'no-store');

  assert.equal(c.ttl.get('project:issues:fresh'), 900000);
  assert.equal(c.ttl.get('project:issues:stale'), 86400000);

  assert.equal(requests.length, 1);
  assert.match(
    requests[0].url,
    /github\.com\/repos\/guillermomolina\/protos\/issues\?/,
  );
  assert.equal(requests[0].options.method, 'GET');
});

test('Actions cache is independent and reports run facts', async () => {
  const c = cache();

  await serveIssues(request(), {
    cache: c,
    fetcher: fetchJSON([issue(1)]),
  });

  const r = request();

  await serveActions(r, {
    cache: c,
    fetcher: fetchJSON({
      total_count: 1,
      workflow_runs: [run(1)],
    }),
  });

  assert.equal(r.code, 200);
  assert.equal(r.headersOut['X-Protos-Cache'], 'MISS');
  assert.equal(r.body.kind, 'actions');
  assert.equal(r.body.entries[0].conclusion, 'success');
  assert.equal('testsPassed' in r.body, false);

  assert.ok(c.get('project:issues:fresh'));
  assert.ok(c.get('project:actions:fresh'));
});

test('Upstream failure preserves stale and backs off', async () => {
  const c = cache();

  await serveIssues(request(), {
    cache: c,
    fetcher: fetchJSON([issue(1)]),
  });

  c.delete('project:issues:fresh');

  let attempts = 0;

  const deps = {
    cache: c,
    fetcher: async () => {
      attempts++;
      throw new Error('offline');
    },
  };

  const first = request();
  const second = request();

  await serveIssues(first, deps);
  await serveIssues(second, deps);

  assert.equal(first.code, 200);
  assert.equal(first.body.state, 'stale');
  assert.equal(first.headersOut['X-Protos-Cache'], 'STALE');
  assert.equal(second.body.state, 'stale');
  assert.equal(attempts, 1);
});

test('No shared cache returns 503 without fetch', async () => {
  const r = request();

  await serveIssues(r, {
    fetcher() {
      throw new Error('Should not fetch');
    },
  });

  assert.equal(r.code, 503);
  assert.equal(r.body.state, 'unavailable');
  assert.deepEqual(r.body.entries, []);
});

test('Malformed upstream data is not cached', async () => {
  const c = cache();
  const r = request();

  await serveActions(r, {
    cache: c,
    fetcher: fetchJSON({ workflow_runs: [] }),
  });

  assert.equal(r.code, 503);
  assert.equal(c.get('project:actions:fresh'), undefined);
  assert.equal(c.get('project:actions:stale'), undefined);
});

test('GitHub rate limit activates backoff', async () => {
  const c = cache();
  const r = request();

  await serveActions(r, {
    cache: c,
    fetcher: async () => ({
      status: 403,
      async text() {
        throw new Error('Should not read error body');
      },
    }),
  });

  assert.equal(r.code, 503);
  assert.equal(c.get('project:actions:backoff'), '1');
});

test('Fetch lease prevents duplicate requests', async () => {
  const c = cache();
  const r = request();

  c.set('project:issues:fetching', '1');

  await serveIssues(r, {
    cache: c,
    fetcher() {
      throw new Error('Should not fetch');
    },
  });

  assert.equal(r.code, 503);
});

test('POST cannot trigger an upstream request', async () => {
  const r = request('POST');

  await serveIssues(r, {
    cache: cache(),
    fetcher() {
      throw new Error('Should not fetch');
    },
  });

  assert.equal(r.code, 405);
  assert.equal(r.headersOut.Allow, 'GET');
});

test('Empty issue page is a valid sample', async () => {
  const r = request();

  await serveIssues(r, {
    cache: cache(),
    fetcher: fetchJSON([]),
  });

  assert.equal(r.code, 200);
  assert.deepEqual(r.body.entries, []);
  assert.equal(r.body.scope, 'recent-open-issues');
});

test('Oversized upstream response is rejected', async () => {
  const c = cache();
  const r = request();

  await serveIssues(r, {
    cache: c,
    fetcher: async () => ({
      status: 200,
      async text() {
        return ' '.repeat(769 * 1024);
      },
    }),
  });

  assert.equal(r.code, 503);
  assert.equal(c.get('project:issues:stale'), undefined);
});
