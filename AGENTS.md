# Protos Website Agent Guidelines

## Repository purpose

`guillermomolina/protos-website` owns the public website implementation for
Protos. It is a companion repository, not the authority for Protos language
semantics or maintained canonical language documentation.

## Authority boundary

- `guillermomolina/protos` remains authoritative for language implementation,
  specification, maintained guide material, tutorials, examples, and design
  sources it owns.
- This repository may curate, render, index, style, navigate, and deploy those
  sources from the exact revision recorded in `protos-source.lock.json`.
- Generated/materialized canonical Protos inputs must not be committed as a
  separately maintained content fork.
- Website work must not silently redefine Protos semantics.

## Architecture

WEB001-B ratified, with its original hosting component superseded by WEB001-F:

- independent companion repository;
- exact-SHA read-only Protos source consumption;
- native Node and Docker Compose local execution through the same contracts;
- Astro + Starlight;
- static output;
- one self-hosted production path using an immutable static-serving image behind
  a private reverse proxy;
- NGINX Unprivileged as the WEB001-G production static-serving runtime, using an
  Alpine slim image pinned by exact version and immutable digest;
- the public repository owns only portable build/serving behavior; routing, TLS,
  network names, host paths, credentials, and production orchestration remain
  private deployment concerns;
- GitHub Pages is superseded and is not retained as a standby production path;
- no write authority from the website to `guillermomolina/protos`;
- any future code-executing playground is a separate security/deployment
  boundary.

## Working rules

- Keep the repository clean before applying generated bootstrap/patch launchers.
- Do not repair unrelated caller state.
- Stage files explicitly; do not use `git add -A` in automated publication.
- Do not force-push.
- Pin third-party GitHub Actions to immutable full commit SHAs.
- Keep dependency locks committed.
- Treat `tmp` as repository-local scratch; it may be a symlink and must remain
  ignored.
- If implementation exposes a substantive new architecture, security, identity,
  compatibility, or authority decision, stop that slice and return to the Protos
  WEBxxx governance/approval process.

Canonical live coordination for the production static-serving image is Protos
Issue #297 (`WEB001-G`), under WEB001 / #278.
