---
name: delegation-topology
description: Pi-specific delegation mechanisms and slash-command topology
injection: always
---

Pi wiring for the delegation shapes described in `tool-usage`. This maps portable delegation intent onto concrete Pi mechanisms.

- single specialist — `/run`
- sequential handoff — `/chain`
- parallel independent tracks — `/parallel`, or the `subagent` tool's `chain`/`tasks` modes
- Prefer the `subagent` tool over manual roleplay for multi-agent work.
- Bound every delegated child. State a hard tool-call budget and an explicit stop rule in the task text. A child given no budget explores until it hits the harness timeout, and several children doing that at once can outlive the parent's tracking window and destroy the turn, taking completed sibling work with it.
- Dispatch a large fan-out in waves and gate each wave on the previous one's success rate. When a wave degrades, shrink the batch or stop; do not dispatch the next wave into a failing system. Piloting the task shape on one or two items before committing the full batch is cheap insurance.
- A child that timed out is not a child that did nothing. Harvest its partial artifact, transcript, or written output before redoing the work, because findings frequently survive the timeout. Re-dispatch a reviewer that returns only a preamble rather than reading silence as approval.
