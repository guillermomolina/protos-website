---
title: Getting started
description: Build Protos, run a program, and use the REPL.
---

# Getting started

Protos is under active development and its Core v0.1 specification is still a
draft. The commands here correspond to the Protos source revision locked by this
website.

## Build the reference implementation

From a Protos source checkout:

```sh
mvn package
```

## Run the hello-world example

```sh
bin/protos protos/examples/hello-world.protos
```

## Start the REPL

Run the CLI with no arguments:

```sh
bin/protos
```

You can also evaluate source directly:

```sh
bin/protos -e 'print("Hello, Protos!")'
```

## A first look at the object model

```js
animal: {
    alive: true

    speak: () => {
        print(name)
    }
}

dog: animal {
    name: "Rex"
}

dog.speak()
```

`dog` delegates to `animal`. There are no classes or constructors in this
example: objects delegate directly to other objects.

A fundamental Protos distinction is visible even in small programs:

```text
: creates a slot
= modifies an existing slot
```

Continue with the [programming guide](/learn/guide/) for the mental model, or
the [tutorials](/learn/tutorials/) for progressive executable programs.

## Authority

This page is an onboarding view. Observable language syntax and semantics are
defined by the [language reference](/reference/language/) and, ultimately, the
normative specification in the canonical Protos repository.
