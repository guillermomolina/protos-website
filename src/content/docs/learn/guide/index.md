---
title: Programming guide
description: The conceptual path through Protos objects, state, control flow, concurrency, and authority.
---

# Programming guide

The Programming Guide follows the current **HEAD of Protos `main`** through
the live documentation reader. Each response is tied to one exact commit;
the website does not compile or maintain a second documentation copy.

The guide is non-normative: if guide prose and the applicable specification
disagree, the specification wins.

## Chapters

Start with the canonical [first-program walkthrough](/docs/live/?family=guide&path=docs/guide/first-program.md)
before working through the numbered chapters. It is generated from the same
locked Protos revision as the rest of the guide.

1. [Values and bindings](/docs/live/?family=guide&path=docs/guide/01-bindings-contexts-and-state.md)
2. [Objects](/docs/live/?family=guide&path=docs/guide/02-objects-delegation-and-composition.md)
3. [Functions and methods](/docs/live/?family=guide&path=docs/guide/03-closures-methods-and-receivers.md)
4. [Decisions and loops](/docs/live/?family=guide&path=docs/guide/04-control-flow-through-protocols.md)
5. [Collections](/docs/live/?family=guide&path=docs/guide/05-values-identity-equality-and-collections.md)
6. [Modules](/docs/live/?family=guide&path=docs/guide/06-modules-and-imports.md)
7. [Errors and cleanup](/docs/live/?family=guide&path=docs/guide/07-errors-handlers-ensure-and-resource-lifetime.md)
8. [Futures](/docs/live/?family=guide&path=docs/guide/08-futures-and-structured-concurrency.md)
9. [Parallel computation](/docs/live/?family=guide&path=docs/guide/09-isolated-parallel-execution.md)
10. [Actors](/docs/live/?family=guide&path=docs/guide/10-actors-actorrefs-and-groups.md)
11. [Files and I/O](/docs/live/?family=guide&path=docs/guide/11-process-io-filesystems-and-authority.md)
    — including what each launcher grants and Filesystem/Network examples
12. [Matching](/docs/live/?family=guide&path=docs/guide/12-matching-expressions.md)

To install and run Protos first, start with
[Try Protos](/docs/live/?family=guide&path=docs/guide/00-try-protos.md).

## Toolchain guides

- [Bundled Tools](/docs/live/?family=guide&path=docs/guide/tools/README.md)
- [The `protos` command line](/docs/live/?family=guide&path=docs/guide/tools/cli.md)
- [Language server](/docs/live/?family=guide&path=docs/guide/tools/language-server.md)
- [Package Tool](/docs/live/?family=guide&path=docs/guide/tools/package-tool.md)
- [Test Tool](/docs/live/?family=guide&path=docs/guide/tools/test-tool.md)

## Standard Library guides

- [Standard Library overview](/docs/live/?family=guide&path=docs/guide/library/README.md)
- [Regular expressions](/docs/live/?family=guide&path=docs/guide/library/regex.md)
- [Dates, times, and durations](/docs/live/?family=guide&path=docs/guide/library/datetime.md)
- [Structured logging](/docs/live/?family=guide&path=docs/guide/library/logging.md)
- [Text styling and encodings](/docs/live/?family=guide&path=docs/guide/library/text.md)
- [Semantic versions](/docs/live/?family=guide&path=docs/guide/library/semver.md)
- [HTTP/1.1](/docs/live/?family=guide&path=docs/guide/library/http.md) and
  [TLS client](/docs/live/?family=guide&path=docs/guide/library/tls.md)
- [Networking and name resolution](/docs/live/?family=guide&path=docs/guide/library/networking.md)
- [SQLite databases](/docs/live/?family=guide&path=docs/guide/library/sqlite.md)
- [C declarations and native libraries](/docs/live/?family=guide&path=docs/guide/library/ffi.md)
- [Cryptography](/docs/live/?family=guide&path=docs/guide/library/crypto.md)
- [Linear algebra](/docs/live/?family=guide&path=docs/guide/library/linear-algebra.md)
- [Runtime metadata](/docs/live/?family=guide&path=docs/guide/library/runtime.md) and
  [inspection](/docs/live/?family=guide&path=docs/guide/library/inspect.md)
- [Explicit foreign operations](/docs/live/?family=guide&path=docs/guide/library/interop.md)

## Java integration guides

- [Embedding Protos in a Java application](/docs/live/?family=guide&path=docs/guide/embedding/java.md)
- [Supplying application modules from Java](/docs/live/?family=guide&path=docs/guide/embedding/application-modules.md)
- [Foreign interoperability](/docs/live/?family=guide&path=docs/guide/interop/README.md)
- [Writing and registering an external provider](/docs/live/?family=guide&path=docs/guide/interop/custom-provider.md)
- [The `java:` provider fixture](/docs/live/?family=guide&path=docs/guide/interop/java-provider.md)
- [FFM provider: Portable JVM and Native Image](/docs/live/?family=guide&path=docs/guide/interop/ffm-provider.md)

The [source-style guide](/docs/live/?family=guide&path=docs/guide/SOURCE_STYLE.md)
and all canonical chapters are served from a resolved, immutable main-HEAD
snapshot. On GitHub publication or cache refresh, new chapters appear without
rebuilding the website.
