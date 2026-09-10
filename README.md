# Protos Website

Official website implementation for the
[Protos programming language](https://github.com/guillermomolina/protos).

The intended public domain is `https://protos.guillermolina.com`.

## Architecture

This is an independent companion repository. Canonical Protos language,
specification, guide, tutorial, example, and selected design sources remain in
`guillermomolina/protos`.

The website consumes an exact read-only Protos revision recorded in
`protos-source.lock.json`.

Initial locked Protos revision:

```text
9f33e1b0e29d0439daebe278c8897f209ad4ce9e
```

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

## Deployment

The public repository deliberately contains no environment-specific production
routing, TLS, network names, host paths, credentials, or orchestration
configuration. Those are private deployment concerns.

GitHub Pages was superseded by WEB001-F and is not retained as a standby
production path. The website remains ordinary static output, so the hosting
mechanism can be changed later without changing website semantics.

## Project coordination

Production static-serving-image work is tracked in
[WEB001-G / Protos #297](https://github.com/guillermomolina/protos/issues/297).
