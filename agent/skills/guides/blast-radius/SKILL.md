---
name: blast-radius
description: Trace a concrete change through hidden consumers and prove the few facts on which its safety depends
injection: explicit
---

Begin with the actual diff and the contracts it changes. Trace direct callers and consumers, then inspect boundaries that symbol search often misses: wire and storage formats, dependency versions and behavior, lifecycle or timing effects, flags, jobs and events, generated artifacts, and downstream language or process boundaries.

Identify the one or two facts on which safety most depends. Prove them with the cheapest real executable check available, preferring an existing focused check. A one-off proof may use a temporary artifact outside the repository; do not create durable scaffolding unless it has continuing value.

Separate confirmed risks, cleared risks, and unverified risks. Give likelihood or impact only when evidence supports the rating. Keep product code read-only unless the user separately authorizes a fix, and obtain confirmation before proofs that could affect shared state, the network, or other users.

Report using `evidence-report`, including the executed proof and exit status or a precise reason it was impractical. Callers must inject that format explicitly when required.
