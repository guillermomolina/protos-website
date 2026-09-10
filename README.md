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

```sh
npm ci
npm run build
```

Static output is written to `dist/`.

## Deployment

The GitHub Pages workflow is initially manual (`workflow_dispatch`) so creating
the bootstrap commit does not attempt a production deployment before Pages and
DNS are configured.

The workflow uses immutable full-SHA pins for its GitHub Actions.

## Project coordination

Website bootstrap work is tracked in
[WEB001-C / Protos #285](https://github.com/guillermomolina/protos/issues/285).
