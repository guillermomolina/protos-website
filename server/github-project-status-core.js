// WEB011-C2: fixed, read-only GitHub project signals.
// Never derive repository totals from a paginated sample.

const PROJECT_REPO = 'guillermomolina/protos';

const ISSUES_UPSTREAM =
  `https://api.github.com/repos/${PROJECT_REPO}/issues?state=open&sort=updated&direction=desc&per_page=30`;

const ACTIONS_UPSTREAM =
  `https://api.github.com/repos/${PROJECT_REPO}/actions/runs?per_page=10`;

const MAX_ISSUES_SOURCE = 30;
const MAX_RUNS_SOURCE = 10;
const MAX_ISSUES_DISPLAY = 6;
const MAX_RUNS_DISPLAY = 5;

const RUN_STATUSES = [
  'queued',
  'in_progress',
  'completed',
  'requested',
  'waiting',
  'pending',
  'action_required',
];

const RUN_CONCLUSIONS = [
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'startup_failure',
  'stale',
];

function boundedString(value, max) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  if (Array.from(value).length > max) {
    return null;
  }

  return value.trim();
}

function utcDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
  ) {
    return null;
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const iso = new Date(timestamp).toISOString();

  return iso.slice(0, 19) === value.slice(0, 19)
    ? value
    : null;
}

function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function issueRecord(raw) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    !positiveId(raw.number) ||
    raw.state !== 'open'
  ) {
    return null;
  }

  const title = boundedString(raw.title, 200);
  const updatedAt = utcDate(raw.updated_at);

  const href =
    `https://github.com/${PROJECT_REPO}/issues/${raw.number}`;

  if (!title || !updatedAt || raw.html_url !== href) {
    return null;
  }

  return {
    number: raw.number,
    title,
    href,
    updatedAt,
  };
}

function runRecord(raw) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    !positiveId(raw.id)
  ) {
    return null;
  }

  const name = boundedString(raw.name, 120);
  const createdAt = utcDate(raw.created_at);

  const href =
    `https://github.com/${PROJECT_REPO}/actions/runs/${raw.id}`;

  if (
    !name ||
    !createdAt ||
    raw.html_url !== href ||
    !RUN_STATUSES.includes(raw.status)
  ) {
    return null;
  }

  const conclusion = raw.conclusion;

  if (
    conclusion !== null &&
    !RUN_CONCLUSIONS.includes(conclusion)
  ) {
    return null;
  }

  if (
    raw.status !== 'completed' &&
    conclusion !== null
  ) {
    return null;
  }

  const branch = raw.head_branch === null
    ? null
    : boundedString(raw.head_branch, 120);

  if (
    branch === null &&
    raw.head_branch !== null
  ) {
    return null;
  }

  const sha = raw.head_sha;

  if (
    typeof sha !== 'string' ||
    !/^[0-9a-f]{40}$/.test(sha)
  ) {
    return null;
  }

  return {
    id: raw.id,
    name,
    href,
    status: raw.status,
    conclusion,
    branch,
    headSha: sha,
    createdAt,
  };
}

function normalizeOpenIssues(payload) {
  if (
    !Array.isArray(payload) ||
    payload.length > MAX_ISSUES_SOURCE
  ) {
    throw new Error('Invalid GitHub issues response');
  }

  const entries = [];
  const seen = [];

  let bad = 0;
  let actualIssues = 0;

  for (let i = 0; i < payload.length; i++) {
    const raw = payload[i];
    // The GitHub Issues REST API also includes pull requests.
    if (
      raw &&
      typeof raw === 'object' &&
      'pull_request' in raw
    ) {
      continue;
    }

    actualIssues += 1;

    const entry = issueRecord(raw);

    if (!entry) {
      bad += 1;
      continue;
    }

    if (seen.includes(entry.number)) {
      continue;
    }

    seen.push(entry.number);

    if (entries.length < MAX_ISSUES_DISPLAY) {
      entries.push(entry);
    }
  }

  if (
    actualIssues > 0 &&
    bad === actualIssues
  ) {
    throw new Error(
      'GitHub issues response has no valid issue records',
    );
  }

  return {
    schemaVersion: 1,
    kind: 'issues',
    scope: 'recent-open-issues',
    sampled: true,
    entries,
  };
}

function normalizeWorkflowRuns(payload) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    !Number.isSafeInteger(payload.total_count) ||
    payload.total_count < 0 ||
    !Array.isArray(payload.workflow_runs) ||
    payload.workflow_runs.length > MAX_RUNS_SOURCE ||
    payload.workflow_runs.length > payload.total_count
  ) {
    throw new Error('Invalid GitHub Actions response');
  }

  const entries = [];
  const seen = [];

  let bad = 0;

  for (let i = 0; i < payload.workflow_runs.length; i++) {
    const raw = payload.workflow_runs[i];
    const entry = runRecord(raw);

    if (!entry) {
      bad += 1;
      continue;
    }

    if (seen.includes(entry.id)) {
      continue;
    }

    seen.push(entry.id);

    if (entries.length < MAX_RUNS_DISPLAY) {
      entries.push(entry);
    }
  }

  if (
    payload.workflow_runs.length > 0 &&
    bad === payload.workflow_runs.length
  ) {
    throw new Error(
      'GitHub Actions response has no valid workflow runs',
    );
  }

  return {
    schemaVersion: 1,
    kind: 'actions',
    scope: 'recent-workflow-runs',
    sampled: true,
    entries,
  };
}

export default {
  PROJECT_REPO,
  ISSUES_UPSTREAM,
  ACTIONS_UPSTREAM,
  normalizeOpenIssues,
  normalizeWorkflowRuns,
};
