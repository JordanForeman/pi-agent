---
name: test-first
description: Use red-green-refactor for new behavior, with a bounded exception for misleading or disproportionate tests
injection: always
---

For new behavior, bug fixes, integrations, and utilities, use red → green → refactor:

1. Write or identify the focused test first and run it.
2. Confirm it fails because the intended behavior is absent, not because setup is broken.
3. Add the smallest implementation that makes it pass; do not add untested behavior.
4. Refactor only under green and rerun the relevant tests after each cleanup.

### Bounded pragmatic exception

Before implementation, state when a meaningful failing test would require broad harness creation, brittle or implementation-coupled mocks, unrelated fixtures, production-only state, or disproportionate infrastructure. In that case use the closest executable regression proof and record the gap. Prefer no new test over one that creates false confidence. This exception is invalid when a cheap existing test path can express the behavior.

For a behavior-preserving refactor, keep tests unchanged and run them before and after. Explicit prototypes may defer tests, but identify the gap before shipping. Configuration-only changes need tests only when executable generation or validation warrants them.

Do not combine red and implementation into an unverifiable pass, skip runs between phases, mirror implementation details, or weaken a valid existing test merely to get green.
