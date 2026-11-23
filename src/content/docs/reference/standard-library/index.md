---
title: Standard library
description: Live Protos library source and separately published D064 API data.
---

# Standard library

**Current source:** [Browse the Standard Library](/docs/live/?family=library).
The live reader follows `protos/lib` on the development `main` branch,
resolves it to an exact immutable commit, and shows that commit for each file.
New source modules require no website rebuild.

## Published API model (D064)

The [published D064 API JSON](/api/live/docs/d064) is consumed from the
independently published GHCR OCI artifact by the existing NGINX service.
That service validates its exact publication and content digests and exposes
its `sourceRevision` provenance.

**The active D064 publication may lag `main`.** It must not be called the
current-main API when the returned `publication.sourceRevision` does not
match the commit shown by the [live source catalog](/docs/live/?family=library).
An absent or lagging D064 publication does not change the authoritative
Protos source or the specification.

For normative language behavior, open the
[language specification](/docs/live/?family=spec).
