---
title: Programming guide
description: The conceptual path through Protos objects, state, control flow, concurrency, and authority.
---

# Programming guide

The Programming Guide is rendered at build time from the **exact Protos revision
locked by this website**. The generated chapter inputs are ignored and are never
maintained as a second documentation fork.

The guide is non-normative: if guide prose and the applicable specification
disagree, the specification wins.

## Chapters

1. [Bindings, contexts, and object state](/learn/guide/01-bindings-contexts-and-state/)
2. [Objects, delegation, and composition](/learn/guide/02-objects-delegation-and-composition/)
3. [Closures, methods, and receivers](/learn/guide/03-closures-methods-and-receivers/)
4. [Control flow through ordinary protocols](/learn/guide/04-control-flow-through-protocols/)
5. [Values, identity, equality, and collections](/learn/guide/05-values-identity-equality-and-collections/)
6. [Modules and imports](/learn/guide/06-modules-and-imports/)
7. [Errors, handlers, `ensure`, and resource lifetime](/learn/guide/07-errors-handlers-ensure-and-resource-lifetime/)
8. [Futures and structured concurrency](/learn/guide/08-futures-and-structured-concurrency/)
9. [Isolated parallel execution](/learn/guide/09-isolated-parallel-execution/)
10. [Actors, ActorRefs, and Actor Groups](/learn/guide/10-actors-actorrefs-and-groups/)
11. [Process, I/O, Filesystems, and Authority](/learn/guide/11-process-io-filesystems-and-authority/)
    — including what each launcher grants and Filesystem/Network examples
12. [Protocol-first matching and case selection](/learn/guide/12-matching-expressions/)

To install and run Protos first, start with
[Try Protos](/learn/getting-started/).

## Toolchain guides

- [Bundled Tools](/learn/guide/tools/)
- [The `protos` command line](/learn/guide/tools/cli/)
- [Language server](/learn/guide/tools/language-server/)
- [Package Tool](/learn/guide/tools/package-tool/)
- [Test Tool](/learn/guide/tools/test-tool/)

## Standard Library guides

- [Standard Library overview](/learn/guide/library/)
- [Regular expressions](/learn/guide/library/regex/)
- [Dates, times, and durations](/learn/guide/library/datetime/)
- [Structured logging](/learn/guide/library/logging/)
- [Text styling and encodings](/learn/guide/library/text/)
- [Semantic versions](/learn/guide/library/semver/)
- [Explicit foreign operations](/learn/guide/library/interop/)

## Java integration guides

- [Embedding Protos in a Java application](/learn/guide/embedding/java/)
- [Supplying application modules from Java](/learn/guide/embedding/application-modules/)
- [Foreign interoperability](/learn/guide/interop/)
- [Writing and registering an external provider](/learn/guide/interop/custom-provider/)
- [The `java:` provider fixture](/learn/guide/interop/java-provider/)

The canonical [source-style guide](/learn/guide/source-style/) is rendered by
the same exact-revision pipeline.

Links between rendered guide pages stay inside this website. Relative links from
the canonical guide to specifications, tests, implementation sources, tutorials,
or other repository material are rewritten to the exact locked GitHub revision,
so browsing the website cannot silently mix documentation from different Protos
revisions.
