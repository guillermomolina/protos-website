// WEB011-D: njs adapter for GitHub Announcements.
// XML parsing stays server-side, never in the browser.

import xml from 'xml';
import announcements from './github-announcements-core.js';
import service from './github-announcements-service.js';

function parseAnnouncements(raw) {
  // Never enable DTD/entity declarations in an external feed.
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(raw)) {
    throw new Error('Unsupported XML declaration');
  }

  const document = xml.parse(raw);
  const root = document.$root;

  if (!root) {
    throw new Error('Missing Atom root');
  }

  const sourceEntries = root.$tags$entry || [];
  const entries =
    announcements.normalizeAnnouncementsDocument(document);

  // Never cache a silently rejected non-empty GitHub feed.
  // A legitimately empty Atom feed is still allowed.
  if (sourceEntries.length > 0 && entries.length === 0) {
    throw new Error('Unexpected empty Atom normalization');
  }

  return entries;
}

async function news(request) {
  return service.serveAnnouncements(request, {
    cache: ngx.shared.protos_content,
    fetcher: function(url, options) {
      return ngx.fetch(url, options);
    },
    parseFeed: parseAnnouncements,
  });
}

export default {
  news: news,
};
