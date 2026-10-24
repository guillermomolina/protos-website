// WEB011: render canonical GitHub Announcements from same-origin NGINX.
// No GitHub API calls, HTML injection, or static news copies.

const ENDPOINT = '/api/live/news';

const DISCUSSION_URL =
  /^https:\/\/github\.com\/guillermomolina\/protos\/discussions\/[1-9][0-9]*$/;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDate(date) {
  if (
    typeof date !== 'string' ||
    !DATE_PATTERN.test(date)
  ) {
    return false;
  }

  const timestamp = Date.parse(`${date}T00:00:00Z`);

  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === date
  );
}

function validatePayload(payload) {
  if (
    !payload ||
    payload.schemaVersion !== 1 ||
    (payload.state !== 'fresh' && payload.state !== 'stale') ||
    !Array.isArray(payload.entries) ||
    payload.entries.length > 20
  ) {
    return null;
  }

  const entries = [];

  for (const entry of payload.entries) {
    if (
      !entry ||
      typeof entry.title !== 'string' ||
      entry.title.trim().length === 0 ||
      Array.from(entry.title).length > 200 ||
      typeof entry.summary !== 'string' ||
      Array.from(entry.summary).length > 240 ||
      typeof entry.href !== 'string' ||
      !DISCUSSION_URL.test(entry.href) ||
      !validDate(entry.date)
    ) {
      return null;
    }

    entries.push({
      title: entry.title,
      date: entry.date,
      summary: entry.summary,
      href: entry.href,
    });
  }

  return entries;
}

export function applyLiveNews(documentRoot, payload) {
  const entries = validatePayload(payload);

  // Empty or invalid data must not replace the page fallback.
  if (!entries || entries.length === 0) return false;

  const container = documentRoot.querySelector(
    '[data-live-news="cards"]',
  );

  const status = documentRoot.querySelector(
    '[data-live-news="status"]',
  );

  if (!container || !status) return false;

  const articles = [];

  for (const entry of entries.slice(0, 3)) {
    const article = documentRoot.createElement('article');
    article.className = 'news-card';

    const date = documentRoot.createElement('p');
    date.className = 'news-date';
    date.textContent = entry.date;

    const heading = documentRoot.createElement('h3');
    const link = documentRoot.createElement('a');

    link.href = entry.href;
    link.rel = 'noreferrer';
    link.textContent = entry.title;

    heading.append(link);

    const summary = documentRoot.createElement('p');
    summary.textContent =
      entry.summary || 'Read the announcement on GitHub Discussions.';

    article.append(date, heading, summary);
    articles.push(article);
  }

  container.replaceChildren(...articles);
  status.textContent = '';

  return true;
}

export async function refreshLiveNews(documentRoot, fetcher) {
  try {
    const response = await fetcher(ENDPOINT, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) return false;

    const payload = await response.json();

    return applyLiveNews(documentRoot, payload);
  } catch {
    // Keep the canonical GitHub Discussions fallback visible.
    return false;
  }
}
