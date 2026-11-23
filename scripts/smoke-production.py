#!/usr/bin/env python3
"""WEB010: production HTTP smoke, using only Python's standard library.

The five public endpoints are inspected, not just checked for HTTP 200.
Different development and D064 publication revisions are permitted and shown.
"""

import argparse
import json
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

SHA = re.compile(r"^[0-9a-f]{40}$")
REPO = "guillermomolina/protos"
ROOTS = {
    "spec": "spec/",
    "guide": "docs/guide/",
    "tutorials": "protos/tutorials/",
    "examples": "protos/examples/",
    "library": "protos/lib/",
}
ENDPOINTS = ("/", "/docs/live/", "/api/live/docs/development",
             "/api/live/docs/catalog", "/api/live/docs/d064")
MAX_BODY_BYTES = 4 * 1024 * 1024


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha(value):
    return isinstance(value, str) and SHA.fullmatch(value) is not None


def record(value):
    return isinstance(value, dict)


def snapshot(value):
    require(record(value), "missing snapshot")
    require(value.get("schemaVersion") == 1, "invalid snapshot schema")
    require(value.get("repository") == REPO, "foreign snapshot repository")
    require(value.get("kind") == "development" and value.get("ref") == "main",
            "snapshot does not resolve development/main")
    require(sha(value.get("revision")) and sha(value.get("treeSha")),
            "invalid snapshot Git identities")
    require(value.get("sourceUrl") ==
            f"https://github.com/{REPO}/tree/{value['revision']}",
            "snapshot source URL does not match commit")
    return value


def envelope(value, kind):
    require(record(value) and value.get("schemaVersion") == 1 and
            value.get("kind") == kind, f"unexpected {kind} response")
    require(value.get("state") in ("fresh", "stale"),
            f"{kind} is not fresh or admitted stale")
    return value


def fetch(opener, base_url, path):
    is_json = path.startswith("/api/")
    req = Request(base_url + path,
                  headers={"Accept": "application/json" if is_json else "text/html",
                           "Cache-Control": "no-cache"})
    with opener.open(req, timeout=45) as response:
        require(response.status == 200, f"{path}: HTTP {response.status}")
        content_type = response.headers.get("Content-Type", "")
        require(content_type.lower().startswith(
            "application/json" if is_json else "text/html"),
            f"{path}: wrong content type")
        body = response.read(MAX_BODY_BYTES + 1)
        require(len(body) <= MAX_BODY_BYTES, f"{path}: response too large")
    try:
        text = body.decode("utf-8")
        value = json.loads(text) if is_json else text
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{path}: invalid response body") from exc
    return value


def smoke(base_url):
    url = urlsplit(base_url)
    require(url.scheme == "http" and url.netloc and not url.path and
            not url.query and not url.fragment and not url.username and
            not url.password,
            "expected an HTTP base URL without a path or credentials")

    opener = build_opener(ProxyHandler({}))
    results = {}
    for path in ENDPOINTS:
        results[path] = fetch(opener, base_url.rstrip("/"), path)
        print(f"WEB010_SMOKE {path:<32} 200", flush=True)

    home = results["/"]
    require('/docs/live/?family=guide' in home and
            '/docs/live/?family=spec' in home,
            "home does not select live guide and specification")
    require('data-doc-family' in results["/docs/live/"],
            "live documentation selector is absent")

    development = envelope(results["/api/live/docs/development"],
                           "documentation-snapshot")
    development_snapshot = snapshot(development.get("snapshot"))
    catalog_response = envelope(results["/api/live/docs/catalog"],
                                "documentation-catalog")
    catalog_snapshot = snapshot(catalog_response.get("snapshot"))
    catalog = catalog_response.get("catalog")
    require(record(catalog) and catalog.get("schemaVersion") == 1 and
            catalog.get("kind") == "canonical-document-catalog" and
            catalog.get("repository") == REPO,
            "invalid canonical catalog")
    require(catalog.get("revision") == catalog_snapshot["revision"] and
            catalog.get("treeSha") == catalog_snapshot["treeSha"],
            "catalog does not belong to its snapshot")
    entries = catalog.get("entries")
    require(isinstance(entries, list) and 1 <= len(entries) <= 512,
            "missing or oversized catalog entries")
    seen = set()
    families = set()
    for entry in entries:
        require(record(entry) and entry.get("type") == "blob" and
                sha(entry.get("blobSha")) and
                isinstance(entry.get("size"), int) and entry["size"] >= 0,
                "invalid catalog document entry")
        family, path = entry.get("family"), entry.get("path")
        require(family in ROOTS and isinstance(path, str) and
                path.startswith(ROOTS[family]) and path not in seen,
                "catalog contains unsafe or duplicate paths")
        seen.add(path)
        families.add(family)
    require(families == set(ROOTS), "not all five live source families are present")

    publication_response = envelope(results["/api/live/docs/d064"],
                                    "protos-d064-publication")
    publication = publication_response.get("publication")
    document = publication_response.get("document")
    require(record(publication) and sha(publication.get("sourceRevision")),
            "D064 publication lacks source revision")
    require(record(document) and record(document.get("provenance")) and
            document["provenance"].get("revision") == publication["sourceRevision"],
            "D064 document source differs from publication")

    print(f"WEB010_DOCUMENT_REVISION={catalog_snapshot['revision']}")
    print(f"WEB010_CATALOG_ENTRIES={len(entries)}")
    print(f"WEB010_D064_REVISION={publication['sourceRevision']}")
    if catalog_snapshot["revision"] != development_snapshot["revision"]:
        print("WEB010_NOTE=development and catalog requests resolved different commits")
    if publication["sourceRevision"] != catalog_snapshot["revision"]:
        print("WEB010_NOTE=D064 is a separate published source revision")
    if any(results[endpoint]["state"] == "stale" for endpoint in ENDPOINTS[2:]):
        print("WEB010_NOTE=at least one admitted snapshot was stale")
    print("WEB010_SMOKE=PASS")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:18080")
    args = parser.parse_args()
    try:
        smoke(args.base_url)
    except (ValueError, HTTPError, URLError, TimeoutError, OSError) as exc:
        print(f"WEB010_SMOKE=FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
