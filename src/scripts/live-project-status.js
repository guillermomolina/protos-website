// WEB011-C3: progressive enhancement for public GitHub signals.
const PROJECT = 'https://github.com/guillermomolina/protos';

const CONFIG = {
  issues: {
    endpoint: '/api/live/issues',
    scope: 'recent-open-issues',
    max: 6,
    prefix: `${PROJECT}/issues/`,
  },
  actions: {
    endpoint: '/api/live/actions',
    scope: 'recent-workflow-runs',
    max: 5,
    prefix: `${PROJECT}/actions/runs/`,
  },
};

const STATUSES = new Set([
  'queued', 'in_progress', 'completed', 'requested',
  'waiting', 'pending', 'action_required',
]);

const CONCLUSIONS = new Set([
  'success', 'failure', 'neutral', 'cancelled', 'skipped',
  'timed_out', 'action_required', 'startup_failure', 'stale',
]);

function boundedText(value, maximum) {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    Array.from(value).length <= maximum;
}

function timestamp(value) {
  return typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

export function validateProjectPayload(payload, kind) {
  const config = CONFIG[kind];

  if (
    !config ||
    !payload ||
    typeof payload !== 'object' ||
    payload.schemaVersion !== 1 ||
    payload.kind !== kind ||
    payload.scope !== config.scope ||
    payload.sampled !== true ||
    !['fresh', 'stale'].includes(payload.state) ||
    !Array.isArray(payload.entries) ||
    payload.entries.length > config.max
  ) {
    throw new Error('Invalid project status response');
  }

  for (const entry of payload.entries) {
    const id = entry?.[kind === 'issues' ? 'number' : 'id'];

    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      entry.href !== config.prefix + id
    ) {
      throw new Error('Invalid project status link');
    }

    if (kind === 'issues') {
      if (
        !boundedText(entry.title, 200) ||
        !timestamp(entry.updatedAt)
      ) {
        throw new Error('Invalid issue');
      }
    } else if (
      !boundedText(entry.name, 120) ||
      !STATUSES.has(entry.status) ||
      !(entry.conclusion === null ||
        CONCLUSIONS.has(entry.conclusion)) ||
      (entry.status !== 'completed' &&
        entry.conclusion !== null) ||
      !(entry.branch === null ||
        boundedText(entry.branch, 120)) ||
      typeof entry.headSha !== 'string' ||
      !/^[a-f0-9]{40}$/.test(entry.headSha) ||
      !timestamp(entry.createdAt)
    ) {
      throw new Error('Invalid workflow run');
    }
  }

  return payload;
}

function renderEntry(doc, kind, entry) {
  const item = doc.createElement('li');
  const link = doc.createElement('a');

  link.href = entry.href;
  link.rel = 'noreferrer';
  link.textContent = kind === 'issues'
    ? `#${entry.number} · ${entry.title}`
    : entry.name;

  item.append(link);

  const details = doc.createElement('span');
  details.className = 'project-signal-detail';

  const time = doc.createElement('time');
  const iso = kind === 'issues'
    ? entry.updatedAt
    : entry.createdAt;

  time.dateTime = iso;
  time.textContent = new Date(iso).toLocaleDateString('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

  if (kind === 'issues') {
    details.append('Updated ', time);
  } else {
    const status = entry.status === 'completed'
      ? (entry.conclusion ?? 'completed')
      : entry.status;

    details.append(
      `Workflow run: ${status.replaceAll('_', ' ')} · `,
      time,
    );

    if (entry.branch) {
      details.append(` · ${entry.branch}`);
    }
  }

  item.append(details);
  return item;
}

async function loadPanel(root, kind, fetcher) {
  const status = root.querySelector(
    `[data-project-status-state="${kind}"]`,
  );

  const list = root.querySelector(
    `[data-project-status-list="${kind}"]`,
  );

  if (!status || !list) return;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    9000,
  );

  try {
    const response = await fetcher(CONFIG[kind].endpoint, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error('Live status unavailable');
    }

    const payload = validateProjectPayload(
      await response.json(),
      kind,
    );

    if (!payload.entries.length) {
      list.replaceChildren();
      list.hidden = true;
      status.textContent =
        'No entries in this recent GitHub sample. Browse GitHub for the full history.';
      return;
    }

    const doc = root.ownerDocument || root;
    const fragment = doc.createDocumentFragment();

    for (const entry of payload.entries) {
      fragment.append(renderEntry(doc, kind, entry));
    }

    list.replaceChildren(fragment);
    list.hidden = false;

    status.textContent = payload.state === 'stale'
      ? 'Cached snapshot · GitHub may have newer activity.'
      : 'Recent public GitHub activity · sampled, not a complete history.';
  } catch {
    list.replaceChildren();
    list.hidden = true;

    status.textContent =
      'Live activity is temporarily unavailable. Browse on GitHub.';
  } finally {
    clearTimeout(timeout);
  }
}

export function mountProjectStatus(
  root = document,
  fetcher = globalThis.fetch.bind(globalThis),
) {
  return Promise.allSettled([
    loadPanel(root, 'issues', fetcher),
    loadPanel(root, 'actions', fetcher),
  ]);
}

if (typeof document !== 'undefined') {
  void mountProjectStatus(document);
}
