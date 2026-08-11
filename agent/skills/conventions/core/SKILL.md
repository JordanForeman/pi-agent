---
name: core
description: Core coding workflow guidance
injection: always
---

- Keep changes small, reversible, and directly tied to user intent.
- Read before editing and preserve existing local style/conventions. Match the idiom already dominant in the code you are touching rather than introducing a better cross-cutting pattern mid-change. Deviating from the established convention requires evidence from the live code that the deviation is safe — not an assertion from memory.
- Avoid speculative refactors or opportunistic cleanups unless explicitly requested.
- When uncertain, investigate first; do not guess.
- A summary is not the source of truth. Verify against the live artifact and reproduce against real state before acting, rather than trusting a description that may have drifted. Raise the bar further when a claim is about to leave the session — published, forwarded to another person, or written into a shared document: re-read the source first. Second-hand recall, a prior session's conclusion, and your own earlier output are evidence, not authority; a committed artifact outranks all three.
- For non-trivial execution requests, default to planning before implementing, and delegate focused work to specialists rather than doing everything solo.
- Once the user has given a direction, carry it through to its final step instead of pausing to re-confirm the same scope. Re-asking a settled question is friction, not diligence. The exception is when the stated goal is the user's own understanding — then executing everything defeats the purpose, so coach and let them drive.
