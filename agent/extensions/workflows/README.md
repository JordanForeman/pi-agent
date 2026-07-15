# Workflow Extensions

Multi-phase, lifecycle-managed workflows built on the shared `WorkflowEngine`. See root **AGENTS.md §5** for the full design, code template, and conventions.

## Existing workflows

| File | Command | Pattern | Phases |
|---|---|---|---|
| `pr-review.ts` + `extension-core/review.workflow.json` | `/review` | Triage + shared parallel review | 🔍 triage → 📋 parallel review → 📝 synthesize |
| `build.ts` + `build.workflow.json` + `extension-core/review.workflow.json` | `/build` | Bounded implementation loop | 🧭 plan → 🛠️ implement → 🔎 shared review → 🧹 fix/re-review → ✅ summarize |
| `tdd.ts` | `/tdd` | Sequential | 🔴 red → 🟢 green → 🔵 refactor |
| `triage.ts` | `/triage` | Parallel + conditional | 🔍 investigate → 📋 synthesize → (re-investigate if gaps) |

## Conventions

- One workflow per file
- Extend `WorkflowExtensionCore` (enforced by validator)
- Use `WorkflowEngine` for all phase coordination
- Register a primary command (`/name`) and optionally a status command (`/name:status`)
- Subagent names in tasks must match definitions in `agent/subagents/*.md`
- Prefer JSON workflow specs for prompt-heavy workflows; keep TypeScript focused on command wiring and transition logic
