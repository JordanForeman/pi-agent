---
name: tool-usage
description: Tool selection policy
injection: always
---

- Prefer dedicated tools for file operations over shell command workarounds.
- Use parallel tool calls for independent reads/searches to reduce latency.
- Sequence dependent operations explicitly; do not use placeholder arguments.
- Communicate directly in assistant text, never via shell echo/printf.
- For multi-agent work, prefer a dedicated delegation tool over manual roleplay.
- Choose the delegation shape dynamically per task, smallest viable first, then expand only if needed: a single specialist for one focused task, a sequential handoff when each step depends on the prior, or parallel independent tracks when tracks don't depend on each other.
- For frontend/design objectives (explicit or implicit, e.g. marketing site requests), include a dedicated design agent when useful and propagate that output into implementation.
