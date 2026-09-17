# Workflow Extensions

Multi-phase, lifecycle-managed orchestration built on the shared `WorkflowEngine`. Workflow tasks name repository agents directly and declare `requires` capability metadata so validation can compare each task contract with agent tools.

## Existing workflows

| File | Commands | Pattern | Phases |
|---|---|---|---|
| `build.ts` + `build.workflow.json` + `extension-core/review.workflow.json` | `/build`, `/build:status`, `/founder-mode`, `/founder-mode:status` | One-writer implementation loops | prepare topic branch (`founder-mode`) → plan → implement → shared review → fix/re-review → publish PR (`founder-mode`) → summarize |
| `plan.ts` | `/plan` | Focused read-only planning with Codex Astra | inspect → plan |
| `pr-review.ts` + `extension-core/review.workflow.json` | `/review`, `/review:status` | Triage + shared parallel review | triage → parallel review → synthesize |
| `research.ts` | `/research`, `/research:status` | Bounded read-only investigation | research → cited evidence report |
| `verify.ts` | `/verify`, `/verify:status` | Project plus real-surface proof | verify → evidence verdict |
| `tdd.ts` | `/tdd`, `/tdd:status` | Sequential | red by `builder` → minimal green → constrained refactor |
| `triage.ts` | `/triage`, `/triage:status` | Parallel + conditional | code/log investigation → synthesis → repeat when critical gaps remain |

The build and PR-review parents own fanout through the shared review contract. Specialist reviewers inspect supplied context and repository state directly; ordinary child roles do not launch nested subagents. Workflow skill arrays are complete task-specific overrides: each task must list every skill it needs, including its interaction mode, rather than relying on role defaults.

Planning and review tasks use `openai-codex/gpt-6-astra`. Implementation, fix, branch, and publication tasks use `openai-codex/gpt-5.6-sol`. `/founder-mode` runs up to ten review and repair rounds. It chooses the smallest reversible interpretation of ordinary product, scope, UX, and architecture ambiguity from repository evidence. Missing tests, validation gaps, and other recoverable problems enter the repair loop. One read-only retry may recreate malformed reviewer selection or synthesis output. Branch and publication proof never retries because those phases can mutate git or remote state. Credentials, conflicting requirements, unsafe or destructive operations, protected/shared writes, and ambiguous ownership stop the workflow without publishing. Finalization requires verified GitHub pull request proof.

## Conventions

- Keep one workflow entry point per file and extend `WorkflowExtensionCore`.
- Use `WorkflowEngine` for phase coordination and register a primary command plus a status command where useful.
- Prefer JSON workflow specs for prompt-heavy workflows; keep TypeScript focused on loading, command wiring, and transition logic.
- Task agents must match definitions under `agent/subagents/`.
- Every task declares `requires` immediately after `agent`, including `requires: []` for read-only work. When present, `skill` must immediately follow `requires`; semantic validation rejects later placement. JSON-backed loaders validate and forward the same metadata.
- Require `filesystem-write` and `shell` for tasks that edit files and run commands. Do not infer write authorization from `bash`.
- Include Ralph's `WorkflowDefinition` in `agent/extensions/ralph-loop.ts` when auditing workflow contracts.

`/review`, `/triage`, and `/verify` also have prompt-template fallbacks. Pi resolves an extension command before a same-named prompt template, so the executable workflow command wins while its extension is loaded.

`/research` and `/verify` authorize owned disposable setup through `scratch_workspace`; they do not authorize target-source edits. The tool checks the created root's device/inode identity immediately before removal, while generic destructive Bash remains behind the discipline gate. This check rejects deterministic substitution but does not claim to eliminate a same-user replacement race after the check.
