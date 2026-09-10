---
title: Language reference
description: Canonical Protos Core v0.1 grammar and modular language specification.
---

# Language reference

This section renders the canonical Protos language specification from the
**exact immutable Protos revision** consumed by this website.

The website does not become a second specification authority. Each generated
page identifies its canonical source and revision, and the source document's
own normative, informative, draft, or compatibility status continues to apply.

## Entry points

- [Core Language Specification v0.1](/reference/language/specification/) —
  compatibility/navigation surface for Core v0.1.
- [Grammar](/reference/language/grammar/) — lexical rules, syntax, and mandatory
  lowering.

## Semantic specifications

- [Object model](/reference/language/semantics/object-model/)
- [Callables](/reference/language/semantics/callables/)
- [Execution and control](/reference/language/semantics/execution-and-control/)
- [Values and collections](/reference/language/semantics/values-and-collections/)
- [Modules](/reference/language/semantics/modules/)
- [Errors](/reference/language/semantics/errors/)

## Concurrency

- [Futures and tasks](/reference/language/concurrency/futures-and-tasks/)
- [Parallel execution](/reference/language/concurrency/parallel-execution/)
- [Actors](/reference/language/concurrency/actors/)
- [Distributed runtime](/reference/language/concurrency/distributed-runtime/)

## I/O and authority

- [I/O core](/reference/language/io/io-core/)
- [Process I/O](/reference/language/io/process-io/)
- [Byte I/O](/reference/language/io/byte-io/)
- [Text I/O](/reference/language/io/text-io/)
- [Filesystem](/reference/language/io/filesystem/)
- [Network](/reference/language/io/network/)

## Runtime model

- [Abstract runtime](/reference/language/runtime/abstract-runtime/) — informative
  execution model; it does not independently redefine observable language
  behavior.

The canonical specification changelog remains available in the source
repository as historical material; it is intentionally not rendered as a
primary reference page. Contributor/agent instructions under `spec/AGENTS.md`
are likewise not language-reference content.

For a progressive explanation instead of normative reference material, use the
[Programming Guide](/learn/guide/).
