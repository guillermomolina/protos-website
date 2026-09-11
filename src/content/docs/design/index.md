---
title: Design
description: The principles behind Protos' small semantic universe and its path to scale.
---

# Design

Protos is designed around a central ambition:

> Start small. Grow by composition. Pay for complexity only when the problem
> actually requires it.

This section explains **why** the language is shaped the way it is. It is
non-normative: design rationale can explain a semantic rule, but only the
applicable specification can define observable Protos behavior.

## A small universe that scales

Protos tries to minimize total conceptual complexity rather than merely counting
keywords or named features. A new abstraction earns its place when it removes
more independent rules, exceptions, overloaded responsibilities, or scaling
failures than it introduces.

The goal is that the same underlying model remains recognizable as a program
grows from ordinary sequential code into asynchronous, parallel, Actor-based,
and eventually distributed systems.

## Mechanisms over institutions

Reusable structures should normally be built from general mechanisms rather than
being privileged by the language simply because they are common.

Objects, slots, delegation, closures, messages, Futures, Actors, protocols, and
other existing mechanisms should do as much work as they naturally can. The core
should provide what cannot be implemented safely, portably, or semantically
correctly at a higher level.

## Keep real distinctions visible

Uniformity is useful only when it does not erase important differences.

Creation and modification are different operations. Lexical lookup and receiver
delegation are different relations. Cooperative concurrency, isolated parallel
work, and persistent Actors solve different semantic problems even when all of
them may involve Futures.

Protos prefers explicit boundaries to runtime guesses about programmer intent.

## The specification defines the language

The implementation is not Protos. Neither Truffle, GraalVM, the JVM, tests, nor
historical behavior independently define the language.

The specification owns observable semantics. Implementations retain freedom to
change physical strategy—JIT compilation, bytecode, caching, scheduling,
storage representation, synchronization, or other machinery—provided programs
cannot observe a semantic difference.

## Pay only for what you use

Unused capability should not impose unnecessary runtime, memory, coordination,
deployment, failure-mode, or conceptual cost.

As requirements grow, Protos aims to add the minimum machinery appropriate to
the new boundary rather than forcing simpler code to adopt the strongest model
from the beginning.

## Prefer independence over coordination

Local state, immutable sharing, isolation, bounded ownership, value transfer,
and message passing are preferred where they reduce unnecessary semantic
coupling. Shared mutable state is treated as something to justify and bound,
not as the default substrate for scale.

## Canonical design source

The complete non-normative rationale for the source revision consumed by this
website is the
[Protos Design Philosophy](https://github.com/guillermomolina/protos/blob/6305eaa0af323d3cb1eaf47311e66a9986915118/docs/design/PROTOS_DESIGN_PHILOSOPHY.md).

For defined behavior rather than rationale, use the
[Language reference](/reference/language/).
