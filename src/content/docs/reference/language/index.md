---
title: Language reference
description: Ownership map for the normative Protos Core v0.1 specification.
---

# Language reference

The normative Core v0.1 specification is modular rather than a single monolithic
document.

At a high level:

- **Grammar** owns lexical rules, syntax, and mandatory lowering.
- **Language overview** is the compatibility and navigation surface.
- **Semantic specifications** own observable object, slot, invocation, control,
  value, module, and related behavior.
- **Concurrency specifications** own Futures, structured tasks, isolated
  execution, Actors, and related concurrency semantics.
- **I/O specifications** own process, stream, filesystem, and authority
  semantics.
- The abstract runtime is informative: it explains an execution model but does
  not independently define observable behavior.

That ownership distinction matters. A convenient guide, example, runtime
implementation detail, or website explanation cannot override the normative
owner.

## Core ideas

The current Protos model is built around a small semantic universe:

- everything is an object;
- objects delegate directly to other objects rather than belonging to classes;
- slots are the common storage mechanism;
- slot creation (`:`) and modification (`=`) are distinct operations;
- execution contexts represent lexical state;
- closures are the single executable value;
- reads may delegate, while writes do not silently mutate an ancestor;
- concurrency extends the same object/message/closure model rather than
  replacing it with a parallel type system.

For an introduction, start with [Getting started](/learn/getting-started/).
