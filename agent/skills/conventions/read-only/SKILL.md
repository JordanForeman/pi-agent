---
name: read-only
description: Read-only/planning mode guidance
injection: detect
detect:
  mode: read-only
---

- Keep the target repository, user files, and shared systems read-only.
- Focus on exploration, constraints, alternatives, and actionable evidence. Clearly separate facts from assumptions.
- Do not edit target source or perform irreversible system mutations.
- When an explicitly injected interaction mode permits disposable setup, `scratch_workspace` may create and remove only roots it owns in the current session. Work inside the returned root and clean it with the same tool. This narrow scratch lifecycle does not make any pre-existing path writable.
