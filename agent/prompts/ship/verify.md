---
description: Verify a change against project checks and its affected real surface
subagents: [code-explorer]
---
Use the `subagent` tool with the current single-agent schema:

```json
{
  "agent": "code-explorer",
  "task": "Verify: $@. Discover the project contract, then exercise the affected UI, CLI, service, integration, or library-consumer surface when practical. Separate repository checks from behavioral proof. Return VERIFIED, NOT VERIFIED, or INCONCLUSIVE with commands, exit statuses, direct observations or artifacts, and residual gaps; compilation alone cannot verify behavior.",
  "skill": ["read-only", "code-references", "validation-discovery", "evidence-report"]
}
```
