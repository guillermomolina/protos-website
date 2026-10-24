import test from 'node:test';
import assert from 'node:assert/strict';

import core from '../server/github-project-status-core.js';

const {
  ISSUES_UPSTREAM,
  ACTIONS_UPSTREAM,
  normalizeOpenIssues,
  normalizeWorkflowRuns,
} = core;

const sha = 'a'.repeat(40);
const at = '2026-10-23T03:02:01Z';

function issue(number, extra = {}) {
  return {
    number,
    state: 'open',
    title: `Issue ${number}`,
    html_url:
      `https://github.com/guillermomolina/protos/issues/${number}`,
    updated_at: at,
    ...extra,
  };
}

function run(id, extra = {}) {
  return {
    id,
    name: 'CI',
    status: 'completed',
    conclusion: 'success',
    html_url:
      `https://github.com/guillermomolina/protos/actions/runs/${id}`,
    created_at: at,
    head_branch: 'main',
    head_sha: sha,
    ...extra,
  };
}

test('only fixed upstream URLs with bounded pages', () => {
  assert.equal(
    ISSUES_UPSTREAM,
    'https://api.github.com/repos/guillermomolina/protos/issues?state=open&sort=updated&direction=desc&per_page=30',
  );

  assert.equal(
    ACTIONS_UPSTREAM,
    'https://api.github.com/repos/guillermomolina/protos/actions/runs?per_page=10',
  );
});

test('issues exclude pull requests', () => {
  const output = normalizeOpenIssues([
    issue(10),
    issue(11, { pull_request: {} }),
    issue(12),
  ]);

  assert.deepEqual(
    output.entries.map((item) => item.number),
    [10, 12],
  );

  assert.equal(output.kind, 'issues');
  assert.equal(output.sampled, true);
  assert.equal('total' in output, false);
});

test('issues are bounded and duplicate-safe', () => {
  const output = normalizeOpenIssues([
    issue(1),
    issue(1),
    ...Array.from(
      { length: 12 },
      (_, index) => issue(index + 2),
    ),
  ]);

  assert.deepEqual(
    output.entries.map((item) => item.number),
    [1, 2, 3, 4, 5, 6],
  );
});

test('empty and PR-only issue pages remain samples', () => {
  assert.deepEqual(
    normalizeOpenIssues([]).entries,
    [],
  );

  assert.deepEqual(
    normalizeOpenIssues([
      issue(7, { pull_request: {} }),
    ]).entries,
    [],
  );
});

test('issues reject external URLs', () => {
  const output = normalizeOpenIssues([
    issue(1, {
      html_url: 'https://example.com/phish',
    }),
    issue(2, {
      title: '<img src=x onerror=alert(1)>',
    }),
  ]);

  assert.equal(output.entries.length, 1);

  // Authored titles remain untrusted plain text.
  assert.equal(
    output.entries[0].title,
    '<img src=x onerror=alert(1)>',
  );
});

test('issue length counts Unicode code points', () => {
  assert.equal(
    normalizeOpenIssues([
      issue(1, {
        title: 'x'.repeat(199) + '🚀',
      }),
    ]).entries.length,
    1,
  );

  assert.throws(() =>
    normalizeOpenIssues([
      issue(1, {
        title: 'x'.repeat(200) + '🚀',
      }),
    ]),
  );
});

test('issues reject invalid dates and response shapes', () => {
  assert.throws(() =>
    normalizeOpenIssues([
      issue(2, {
        updated_at: '2026-02-31T00:00:00Z',
      }),
    ]),
  );

  assert.throws(() =>
    normalizeOpenIssues({ items: [] }),
  );

  assert.throws(() =>
    normalizeOpenIssues(
      Array.from(
        { length: 31 },
        (_, index) => issue(index + 1),
      ),
    ),
  );
});

test('Actions report workflow facts, not test results', () => {
  const output = normalizeWorkflowRuns({
    total_count: 2,
    workflow_runs: [
      run(11),
      run(12, {
        status: 'in_progress',
        conclusion: null,
      }),
    ],
  });

  assert.equal(
    output.scope,
    'recent-workflow-runs',
  );

  assert.equal(output.sampled, true);
  assert.equal(output.entries[1].conclusion, null);
  assert.equal('testsPassed' in output, false);
  assert.equal('total' in output, false);
});

test('Actions preserve supported conclusions', () => {
  for (const conclusion of [
    'failure',
    'cancelled',
    'timed_out',
    'neutral',
    'skipped',
  ]) {
    const output = normalizeWorkflowRuns({
      total_count: 1,
      workflow_runs: [
        run(3, { conclusion }),
      ],
    });

    assert.equal(
      output.entries[0].conclusion,
      conclusion,
    );
  }
});

test('Actions reject external URLs and deduplicate', () => {
  const output = normalizeWorkflowRuns({
    total_count: 3,
    workflow_runs: [
      run(1, {
        html_url: 'https://example.com/',
      }),
      run(2),
      run(2),
    ],
  });

  assert.deepEqual(
    output.entries.map((item) => item.id),
    [2],
  );
});

test('Actions reject unknown or inconsistent states', () => {
  for (const extra of [
    { status: 'unknown' },
    { head_sha: 'invalid' },
    {
      status: 'queued',
      conclusion: 'success',
    },
  ]) {
    assert.throws(() =>
      normalizeWorkflowRuns({
        total_count: 1,
        workflow_runs: [
          run(1, extra),
        ],
      }),
    );
  }
});

test('Actions reject malformed and oversized replies', () => {
  assert.throws(() =>
    normalizeWorkflowRuns([]),
  );

  assert.throws(() =>
    normalizeWorkflowRuns({
      total_count: -1,
      workflow_runs: [],
    }),
  );

  assert.throws(() =>
    normalizeWorkflowRuns({
      total_count: 0,
      workflow_runs: [run(1)],
    }),
  );

  assert.throws(() =>
    normalizeWorkflowRuns({
      total_count: 11,
      workflow_runs: Array.from(
        { length: 11 },
        (_, index) => run(index + 1),
      ),
    }),
  );
});

test('Actions allow empty workflow history', () => {
  const output = normalizeWorkflowRuns({
    total_count: 0,
    workflow_runs: [],
  });

  assert.equal(output.kind, 'actions');
  assert.deepEqual(output.entries, []);
});

test('Actions expose only approved public fields', () => {
  const output = normalizeWorkflowRuns({
    total_count: 1,
    workflow_runs: [
      run(1, {
        display_title: '<script>unsafe</script>',
        body: '<b>unsafe</b>',
        token: 'not-public',
      }),
    ],
  });

  assert.deepEqual(
    Object.keys(output.entries[0]),
    [
      'id',
      'name',
      'href',
      'status',
      'conclusion',
      'branch',
      'headSha',
      'createdAt',
    ],
  );
});
