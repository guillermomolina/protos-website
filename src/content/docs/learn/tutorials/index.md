---
title: Tutorials
description: Progressive executable Protos lessons, rendered from the exact locked source revision.
---

# Tutorials

The tutorials are **real executable `.protos` sources**, not pseudo-code copied
into website documentation. At build time this site reads the exact Protos
revision recorded in `protos-source.lock.json` and renders each numbered
tutorial group without modifying the program bodies.

The material is explanatory and non-normative. If a tutorial and the applicable
specification disagree, the specification wins.

## Progression

1. [Values and slots](/learn/tutorials/01-values-and-slots/)
2. [Objects](/learn/tutorials/02-objects/)
3. [Closures](/learn/tutorials/03-closures/)
4. [Control flow](/learn/tutorials/04-control-flow/)
5. [Collections](/learn/tutorials/05-collections/)
6. [Path values](/learn/tutorials/06-path-values/)
7. [Call arguments](/learn/tutorials/07-call-arguments/)
8. [Language interactions](/learn/tutorials/08-language-interactions/)
9. [Futures](/learn/tutorials/09-futures/)
10. [Actors](/learn/tutorials/10-actors/)
11. [Actor groups](/learn/tutorials/11-actor-groups/)
12. [System resources](/learn/tutorials/12-system-resources/)

Each generated group page links every lesson back to its canonical source at
the same immutable Protos revision. The Protos code fences use the canonical
LM009 TextMate grammar already consumed by this website.

:::note[System-resource lessons]
The final group intentionally includes lessons with different execution
authority requirements. In particular, not every system-resource example is a
plain standalone-CLI program; the canonical tutorial README documents where an
explicitly provisioned bootstrap-local capability is required.
:::

Start with [Getting started](/learn/getting-started/) if you have not yet built
the reference implementation.
