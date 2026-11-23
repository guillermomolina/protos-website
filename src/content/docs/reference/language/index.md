---
title: Language reference
description: Canonical Protos Core v0.1 grammar and modular language specification.
---

# Language reference

This section links to the canonical Protos language specification from the
current **HEAD of `main`**. Each live view is bound to one exact commit.

The website does not become a second specification authority. Each live page identifies its canonical source and revision, and the
source document's own normative, informative, draft, or compatibility status
continues to apply.

## Entry points

- [Core Language Specification v0.1](/docs/live/?family=spec&path=spec/PROTOS_LANGUAGE_SPEC.md) —
  compatibility/navigation surface for Core v0.1.
- [Grammar](/docs/live/?family=spec&path=spec/PROTOS_GRAMMAR.md) — lexical rules, syntax, and mandatory
  lowering.

## Semantic specifications

- [Object model](/docs/live/?family=spec&path=spec/semantics/OBJECT_MODEL.md)
- [Callables](/docs/live/?family=spec&path=spec/semantics/CALLABLES.md)
- [Execution and control](/docs/live/?family=spec&path=spec/semantics/EXECUTION_AND_CONTROL.md)
- [Values and collections](/docs/live/?family=spec&path=spec/semantics/VALUES_AND_COLLECTIONS.md)
- [Modules](/docs/live/?family=spec&path=spec/semantics/MODULES.md)
- [Errors](/docs/live/?family=spec&path=spec/semantics/ERRORS.md)
- [Matching](/docs/live/?family=spec&path=spec/semantics/MATCHING.md)
- [Cryptography](/docs/live/?family=spec&path=spec/semantics/CRYPTO.md)
- [Passwords](/docs/live/?family=spec&path=spec/semantics/PASSWORD.md)
- [C interoperability](/docs/live/?family=spec&path=spec/semantics/FFI.md)
- [SQLite](/docs/live/?family=spec&path=spec/semantics/SQLITE.md)

## Concurrency

- [Futures and tasks](/docs/live/?family=spec&path=spec/concurrency/FUTURES_AND_TASKS.md)
- [Parallel execution](/docs/live/?family=spec&path=spec/concurrency/PARALLEL_EXECUTION.md)
- [Actors](/docs/live/?family=spec&path=spec/concurrency/ACTORS.md)
- [Distributed runtime](/docs/live/?family=spec&path=spec/concurrency/DISTRIBUTED_RUNTIME.md)

## I/O and authority

- [I/O core](/docs/live/?family=spec&path=spec/io/IO_CORE.md)
- [Process I/O](/docs/live/?family=spec&path=spec/io/PROCESS_IO.md)
- [Byte I/O](/docs/live/?family=spec&path=spec/io/BYTE_IO.md)
- [Text I/O](/docs/live/?family=spec&path=spec/io/TEXT_IO.md)
- [Filesystem](/docs/live/?family=spec&path=spec/io/FILESYSTEM.md)
- [Network](/docs/live/?family=spec&path=spec/io/NETWORK.md)
- [Clock](/docs/live/?family=spec&path=spec/io/CLOCK.md)
- [Entropy](/docs/live/?family=spec&path=spec/io/ENTROPY.md)
- [External processes](/docs/live/?family=spec&path=spec/io/EXTERNAL_PROCESS.md)
- [HTTP](/docs/live/?family=spec&path=spec/io/HTTP.md)
- [TLS](/docs/live/?family=spec&path=spec/io/TLS.md)

## Runtime model

- [Abstract runtime](/docs/live/?family=spec&path=spec/runtime/ABSTRACT_RUNTIME.md) — informative
  execution model; it does not independently redefine observable language
  behavior.

The canonical specification changelog remains available in the source
repository as historical material; it is intentionally not rendered as a
primary reference page. Contributor/agent instructions under `spec/AGENTS.md`
are likewise not language-reference content.

For a progressive explanation instead of normative reference material, use the
[Programming Guide](/docs/live/?family=guide).
