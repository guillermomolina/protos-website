---
title: Standard library
description: Navigate the exact-source Protos standard-library families without conflating implementation with API contracts.
---

# Standard library

Protos keeps the language core and reusable library facilities conceptually
separate. This website consumes the standard-library implementation from the
same exact immutable Protos revision as the language reference, guide,
tutorials, and examples.

## Exact source browser

[Browse the standard-library source](/reference/standard-library/source/) to
inspect every `.protos` module in the locked `protos/lib` tree.

The source browser preserves canonical family names, filenames, case, relative
paths, source bodies, and exact-SHA provenance in the displayed source identity.
Website route slugs are normalized to lowercase so generated URLs match
Astro/Starlight's static route identity. It is deliberately **not** an
automatically inferred API reference: implementation source alone does not tell
the website which slots are stable public API, which are implementation detail,
or what compatibility guarantees apply.

The locked source currently contains these families:

- **core** — distributable source-backed Core behavior;
- **collections** — collection facilities beyond the minimal Core mechanisms;
- **text** — text/encoding facilities;
- **json** — JSON facilities;
- **io** — reusable I/O facilities;
- **network** — networking facilities;
- **crypto** — cryptographic facilities.

For observable language semantics, use the
[Language reference](/reference/language/). A future semantic/API library
reference should be based on an explicit canonical contract rather than inferred
from implementation structure.
