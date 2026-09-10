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

WEB001-B ratified:

- independent companion repository;
- exact-SHA read-only Protos source consumption;
- native Node and Docker Compose local execution through the same contracts;
- Astro + Starlight;
- static output;
- GitHub Pages as the initial host for `protos.guillermolina.com`;
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

Canonical live coordination for the bootstrap is Protos Issue #285 (`WEB001-C`).
