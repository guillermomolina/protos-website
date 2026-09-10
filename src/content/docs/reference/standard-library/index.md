---
title: Standard library
description: Navigate the library families present in the locked Protos source.
---

# Standard library

Protos keeps the language core and reusable library facilities conceptually
separate. The website does not infer a library API from implementation details;
the canonical Protos source remains authoritative.

The source revision currently locked by this website contains library families
for:

- **core** — source-backed facilities that participate in the bundled core
  library surface;
- **collections** — collection types beyond the minimal core collection
  mechanisms;
- **text** — text and encoding conveniences;
- **json** — JSON facilities;
- **io** — reusable I/O-level facilities;
- **network** — networking facilities;
- **crypto** — cryptographic facilities.

This page is a navigation overview, not an independently maintained API
specification. As the canonical source evolves, library API reference should be
generated or curated from the exact locked revision rather than copied and
allowed to drift.
