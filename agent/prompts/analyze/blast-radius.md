---
description: Trace a change's consumers and prove its safety-critical assumptions
subagents: [code-explorer]
---
Use the `subagent` tool with the current single-agent schema:

```json
{
  "agent": "code-explorer",
  "task": "Analyze the blast radius for: $@",
  "skill": ["read-only", "code-references", "blast-radius", "research-mode", "evidence-report"]
}
```
