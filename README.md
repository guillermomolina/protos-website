# Protos Website

Official website implementation for the
[Protos programming language](https://github.com/guillermomolina/protos).

The intended public domain is `https://protos.guillermomolina.com`.

## Architecture

This is an independent companion repository. Canonical Protos language,
specification, guide, tutorial, example, and selected design sources remain in
`guillermomolina/protos`.

Live development documentation resolves the current Protos `main` branch
and then uses one immutable commit for each document view. The website no
longer builds canonical language documentation from Protos source.

The former Protos source lock remains for historical tooling only; active
documentation no longer depends on that frozen revision.

Syntax highlighting comes from the exact revision recorded in
`protos-vscode-source.lock.json`. The website loads Protos' reusable
non-normative TextMate grammar from
`guillermomolina/protos-vscode-extension` rather than maintaining a
website-specific grammar.

## Local development

The website's active development/build pipeline is **Node.js only**. It does not
compile Protos, run a D064 extractor, or require Java/Maven. Use the official
Node.js devcontainer, or locally install Node.js 22.12+ (or newer), npm and Git:

```sh
npm ci
npm run dev
```

The site serves canonical development documentation from Protos `main` through
NGINX's existing GitHub-backed endpoints. Each catalog and document is bound to
one exact resolved commit; cache freshness/staleness is labeled. Locally, the
Astro dev server builds the presentation, but the `/api/live/**` routes require
the production NGINX+njs runtime for real data. The TextMate grammar is still
consumed from the exact VS Code extension revision, entirely without Java.

## Docker Compose

```sh
docker compose up --build
```

Then open `http://localhost:4321`.

The Compose path uses the same Node-only npm scripts. The VS Code grammar
cache stays inside the container.

## Documentation sources

The primary Learn and Reference navigation uses the live GitHub-backed reader
at `/docs/live/`. No manual Protos version or SHA bump is needed when `main`
changes. Historical static materializers and the former `protos-source.lock.json`
are retained as inactive references; the normal npm pipeline never calls them.

D064 is consumed independently through `/api/live/docs/d064` from the existing
GHCR-published OCI artifact with validated provenance. A publication is not
claimed to match current `main` merely because it is the active D064 artifact.

## Production build

The native static build remains:

```sh
npm ci
npm run build
```

Static output is written to `dist/`.

The production container uses a separate final serving stage:

```sh
docker build --target production -t protos-website:local .
docker run --rm -p 127.0.0.1:8080:8080 protos-website:local
```

Then open `http://localhost:8080`.

The final image is NGINX Unprivileged on internal HTTP port 8080. Node, npm, Git,
JDK, Maven, the website source tree, and all documentation/build dependencies
remain in earlier build stages; only generated static output is copied into the
serving image.

## Production image delivery

Every push to `main` publishes the validated `production` target to:

```text
ghcr.io/guillermomolina/protos-website
```

The workflow publishes `linux/amd64` and `linux/arm64` variants and adds a
full-commit tag such as `sha-<40-hex-commit>` for discovery. **Production
deployment identity is the manifest digest, not a tag**, for example:

```text
ghcr.io/guillermomolina/protos-website@sha256:<64-hex-digest>
```

The workflow reports that exact reference in the GitHub Actions job summary,
logs out of GHCR, and then verifies that the manifest is anonymously readable
and contains both target architectures.

Publication uses GitHub's repository-scoped ephemeral `GITHUB_TOKEN` with only
`contents: read` and `packages: write`. No personal GitHub token is stored in
the repository or required for image publication.

## Deployment boundary

The public repository deliberately contains no environment-specific production
routing, TLS, network names, host paths, credentials, or orchestration
configuration. Those are private deployment concerns.

GitHub Pages was superseded by WEB001-F and is not retained as a standby
production path. The website remains ordinary static output, so the hosting
mechanism can be changed later without changing website semantics.

## Project coordination

Public website content work is tracked in
[WEB001-J / Protos #301](https://github.com/guillermomolina/protos/issues/301).

Private production integration is tracked separately in WEB001-I / Protos #300.
