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

The canonical [source-style guide](/learn/guide/source-style/) is rendered by
the same exact-revision pipeline.

Links between rendered guide pages stay inside this website. Relative links from
the canonical guide to specifications, tests, implementation sources, tutorials,
or other repository material are rewritten to the exact locked GitHub revision,
so browsing the website cannot silently mix documentation from different Protos
revisions.
