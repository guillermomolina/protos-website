// WEB011-D: GitHub Announcements Atom normalization.
// No Node.js or browser dependency. NGINX supplies xml.parse().

const ATOM_NAMESPACE = 'http://www.w3.org/2005/Atom';

const DISCUSSION_URL =
  /^https:\/\/github\.com\/guillermomolina\/protos\/discussions\/[1-9][0-9]*$/;

const MAX_FEED_ENTRIES = 100;
const MAX_OUTPUT_ENTRIES = 20;

function children(node, name) {
  const result = [];

  if (!node || !Array.isArray(node.$tags)) {
    return result;
  }

  for (let index = 0; index < node.$tags.length; index += 1) {
    const child = node.$tags[index];

    if (
      String(child.$name) === name &&
      String(child.$ns) === ATOM_NAMESPACE
    ) {
      result.push(child);
    }
  }

  return result;
}

function firstChild(node, name) {
  const matches = children(node, name);
  return matches.length ? matches[0] : null;
}

function textOf(node) {
  if (
    !node ||
    node.$text === undefined ||
    node.$text === null
  ) {
    return '';
  }

  return String(node.$text).trim();
}

function normalizedText(value, limit) {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function summaryText(value) {
  // Atom content may contain escaped HTML.
  // The output is plain text, never trusted HTML.
  return normalizedText(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
    240,
  );
}

function discussionLink(entry) {
  const links = children(entry, 'link');

  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    const rel = link.$attr$rel === undefined
      ? undefined
      : String(link.$attr$rel);

    const href = link.$attr$href === undefined
      ? undefined
      : String(link.$attr$href);

    if (
      (rel === 'alternate' || rel === undefined) &&
      typeof href === 'string' &&
      DISCUSSION_URL.test(href)
    ) {
      return href;
    }
  }

  return null;
}

function normalizeEntry(entry) {
  const title = normalizedText(
    textOf(firstChild(entry, 'title')),
    200,
  );

  const href = discussionLink(entry);

  const published = firstChild(entry, 'published');
  const updated = firstChild(entry, 'updated');

  const timestampSource = textOf(published || updated);

  // GitHub emits UTC timestamps ending in +00:00.
  // Canonicalize the zero offset for both Node and njs.
  const canonicalTimestamp = timestampSource.replace(
    /\+00:00$/,
    'Z',
  );

  const timestamp = Date.parse(canonicalTimestamp);

  if (
    !title ||
    !href ||
    !timestampSource ||
    !Number.isFinite(timestamp)
  ) {
    return null;
  }

  const summaryNode =
    firstChild(entry, 'summary') ||
    firstChild(entry, 'content');

  return {
    title: title,
    href: href,
    date: new Date(timestamp).toISOString().slice(0, 10),
    summary: summaryText(textOf(summaryNode)),
    timestamp: timestamp,
  };
}

function normalizeAnnouncementsDocument(document) {
  const root = document && (document.$root || document.feed);

  if (
    !root ||
    String(root.$name) !== 'feed' ||
    String(root.$ns) !== ATOM_NAMESPACE
  ) {
    throw new Error('Invalid Atom feed identity');
  }

  const nodes = children(root, 'entry');

  if (nodes.length > MAX_FEED_ENTRIES) {
    throw new Error('Announcement feed exceeds entry limit');
  }

  const result = [];
  const seen = Object.create(null);

  for (let index = 0; index < nodes.length; index += 1) {
    const normalized = normalizeEntry(nodes[index]);

    if (
      normalized &&
      !Object.prototype.hasOwnProperty.call(
        seen,
        normalized.href,
      )
    ) {
      seen[normalized.href] = true;
      result.push(normalized);
    }
  }

  result.sort(function(left, right) {
    return right.timestamp - left.timestamp;
  });

  const selected = result.slice(0, MAX_OUTPUT_ENTRIES);

  return selected.map(function(entry) {
    return {
      title: entry.title,
      href: entry.href,
      date: entry.date,
      summary: entry.summary,
    };
  });
}

export default {
  normalizeAnnouncementsDocument: normalizeAnnouncementsDocument,
};
