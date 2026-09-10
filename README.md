# Protos Website

Official website implementation for the
[Protos programming language](https://github.com/guillermomolina/protos).

The intended public domain is `https://protos.guillermomolina.com`.

## Architecture

This is an independent companion repository. Canonical Protos language,
specification, guide, tutorial, example, and selected design sources remain in
`guillermomolina/protos`.

The website consumes an exact read-only Protos revision recorded in
`protos-source.lock.json`.

The selected revision is intentionally recorded only in
`protos-source.lock.json` so documentation does not duplicate a stale mutable
description of the current source input.

Syntax highlighting also comes from that exact source revision: the website
loads Protos' reusable non-normative TextMate grammar from
`editors/vscode/syntaxes/protos.tmLanguage.json` rather than maintaining a
website-specific grammar.

## Local development

With Node.js 22.12 or newer:

```sh
npm ci
npm run dev
```

Then open `http://localhost:4321`.

The first run materializes the locked canonical Protos source subset into the
ignored `.protos-source` cache.

## Docker Compose

```sh
docker compose up --build
```

Then open `http://localhost:4321`.

The Compose path uses the same npm scripts and source lock. Its Protos source
cache stays inside the container.

## Update the canonical Protos input

Updating the source lock is explicit:

```sh
npm run source:update
npm run build
```

Review and commit the resulting `protos-source.lock.json` change. Ordinary
builds never silently follow moving `protos/main`.

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
the website source tree, and build dependencies remain in earlier build stages;
only generated static output is copied into the serving image.

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
