# Agent Definitions

Reusable role definitions and chains for `pi-subagents`.

## Runtime mapping and schema

- Repo agents: `agent/subagents/*.md`
- Repo chains: `agent/subagents/*.chain.md`
- Home Manager runtime agents: `~/.pi/agent/agents/*.md`
- Home Manager runtime chains: `~/.pi/agent/chains/*.chain.md`

Declare tools and directly injected skills as comma-separated strings:

```yaml
tools: read, bash, grep, find
skills: code-references, api-design
```

Direct `skills:` are a narrow complete default for that role; do not use YAML array syntax. A `skill` supplied by a subagent call overrides role defaults, so callers must pass the complete desired skill list, including any interaction mode. Ordinary child roles leave fanout and follow-up delegation to the parent unless they explicitly declare a supported `subagent` tool.

`builder` and `code-explorer` expose `scratch_workspace` for disposable setup. It creates and removes exact session-owned OS-temp roots; it does not grant permission to mutate target repositories or delete arbitrary paths. Mode skills remain invocation-specific and are not role defaults.

## Inventory

General roles:

- `architect`, `builder`, `code-explainer`, `code-explorer`, `design`, `design-reviewer`
- `dream-ingestor`, `execution-strategist`, `frontend-reviewer`, `git-ops`, `log-viewer`
- `markdown-author`, `planner`, `pr-triage`, `rails-reviewer`, `reviewer`, `svg-editor`
- `team-creator`, `testing-reviewer`

Ralph roles:

- `ralph-groomer`, `ralph-historian`, `ralph-implementer`, `ralph-planner`, `ralph-recon`
- `ralph-summarizer`, `ralph-validator`, `ralph-worker`

Chains:

- `ralph-loop`
- `svg-iterative-edit`

Use `/agents` for runtime discovery. Common invocations include:

```text
/run planner "Plan implementation for issue #123"
/chain code-explorer "Map files" -> planner "Create plan" -> builder "Implement"
/parallel code-explorer "Inspect backend" -> code-explorer "Inspect frontend"
```

## Maintenance

- Keep roles focused and preserve names used by prompts and workflows.
- Put shared engineering judgment in canonical skills rather than copying it across role bodies.
- Mark an intentionally read-only prompt-composer profile explicitly instead of adding bogus mutation tools.

```bash
node agent/scripts/validate-taxonomy.mjs
node agent/subagents/scripts/lint-tool-heuristics.mjs --strict
```
