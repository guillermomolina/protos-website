---
title: Getting started
description: Download the portable Protos pre-release, run a program, use the REPL, or build from source.
---

# Getting started

Protos is under active development and its Core v0.1 specification is still a
draft. The fastest way to try the reference implementation is the published
portable POSIX/JVM pre-release, currently `v0.2.236`. It is a pre-release, not a
stability or compatibility promise.

The website can document a newer exact source revision than the latest portable
release. The runtime and capability contract in this section is therefore tied
explicitly to `v0.2.236`.

## Try the portable pre-release

### 1. Use the supported runtime

The `v0.2.236` portable bundle requires:

- **GraalVM Community Edition for JDK 22**;
- Java feature version **22**;
- Truffle runtime **24.0.0**.

The JDK is not bundled. Java 21 is the bytecode target for this release; that is
**not** a claim that arbitrary Java 21+ runtimes are supported.

### 2. Download and verify Protos 0.2.236

Open the [Protos 0.2.236 release](https://github.com/guillermomolina/protos/releases/tag/v0.2.236)
and download both:

- [`protos-0.2.236-posix-jvm.zip`](https://github.com/guillermomolina/protos/releases/download/v0.2.236/protos-0.2.236-posix-jvm.zip)
- [`protos-0.2.236-posix-jvm.zip.sha256`](https://github.com/guillermomolina/protos/releases/download/v0.2.236/protos-0.2.236-posix-jvm.zip.sha256)

With both files in the same directory, verify the archive:

```sh
sha256sum -c protos-0.2.236-posix-jvm.zip.sha256
```

The expected archive SHA-256 is
`b1a58ba445d082156bd4eb637ee6df70c046abdee600d468c0fac29be065e296`.

### 3. Extract and run it

Extract the ZIP into a new directory and run these commands from the extracted
bundle root, the directory that contains `bin/protos`:

```sh
bin/protos --version
bin/protos -e 'print("Hello, Protos!")'
bin/protos protos/examples/hello-world.protos
```

No Maven build is required to use the portable bundle.

### 4. Start the REPL

Run the CLI with no arguments:

```sh
bin/protos
```

## Build from source

Building from source is the developer/contributor path, not a prerequisite for
trying the public pre-release. From a compatible
[Protos source checkout](https://github.com/guillermomolina/protos), follow the
current repository toolchain requirements and build with:

```sh
mvn package
```

Then the same CLI entry point is available from that checkout:

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
