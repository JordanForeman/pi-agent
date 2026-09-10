---
description: Investigate why existing code acquired its current design
subagents: [code-explorer]
---
Use the `subagent` tool with the current single-agent schema:

```json
{
  "agent": "code-explorer",
  "task": "Investigate the historical rationale for: $@",
  "skill": ["read-only", "code-references", "design-rationale", "evidence-report"]
}
```
