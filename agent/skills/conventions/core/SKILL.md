---
name: core
description: Core coding workflow guidance
injection: always
---

- Keep changes small, reversible, and directly tied to user intent.
- Read before editing and preserve existing local style/conventions. Deviating from the idiom already dominant in the code you are touching requires evidence from the live code that the deviation is safe — not an assertion from memory.
- Avoid speculative refactors or opportunistic cleanups unless explicitly requested.
- When uncertain, investigate first; do not guess.
- A summary is not the source of truth. Verify against the live artifact and reproduce against real state before acting. Re-read the source before a claim leaves the session — published, forwarded, or written into a shared document. Second-hand recall, a prior session's conclusion, and your own earlier output are evidence, not authority; a committed artifact outranks all three.
- For non-trivial execution requests, default to planning before implementing, and delegate focused work to specialists rather than doing everything solo.
- Once the user has given a direction, carry it through to its final step instead of pausing to re-confirm the same scope; re-asking a settled question is friction, not diligence. This never overrides `safety` — anything destructive or hard to reverse still needs confirmation. It also inverts when the stated goal is the user's own understanding: then executing everything defeats the purpose, so coach and let them drive.
- Measure a proposed change's effect before adopting it, including when the user proposed it. If the measurement contradicts the premise — the stricter filter drops results they wanted, the setting does not address the failure they described — show the number and pause. That is not the re-confirmation the bullet above rules out; it is evidence they do not have yet.
- When asked for a filtered set — a queue, a shortlist, a report — encode every stated criterion in the query or check it explicitly afterward. A signal that correlates with a criterion is not that criterion, and a request addressed to a group you belong to is not a request addressed to you. When asked why an item is in the set, name the criteria you actually applied and the stated ones you skipped.
