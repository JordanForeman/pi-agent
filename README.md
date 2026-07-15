# Pi Agent Configuration

This directory contains the shareable Pi configuration synced across Jordan's machines.

> For package/extraction wiring, see the dotfiles repository; this repo owns the Pi agent resources themselves.

## Installation

Install directly from GitHub:

```bash
pi install git:git@github.com:JordanForeman/pi-agent.git@main
```

For a local checkout, install dependencies first so bundled plugin packages and the postinstall bootstrap are available, then install the package path:

```bash
git clone git@github.com:JordanForeman/pi-agent.git
cd pi-agent
npm install
pi install "$PWD"
```

The `postinstall` script symlinks Markdown files under `agent/subagents/` into `~/.pi/agent/agents/` and `*.chain.md` files into `~/.pi/agent/chains/` for `pi-subagents` discovery. It respects `PI_CODING_AGENT_DIR` when set. Pi settings and keybindings are not installed by the package; they remain dotfiles/Home Manager concerns.

Bundled plugin packages include `pi-subagents`, `pi-powerline-footer`, `pi-autoresearch`, `pi-prompt-composer`, and `pi-code-previews`.

This repo sets `legacy-peer-deps=true` in `.npmrc` so Git/local installs do not try to resolve Pi runtime packages that Pi itself provides to extensions.

## Structure

```text
agent/
├── subagents/          # Agent definitions (synced to ~/.pi/agent/agents/)
├── prompts/            # User-facing workflow triggers (ship/analyze/plan/learn)
├── skills/             # Contextual knowledge (conventions/guides/formats/standards)
├── extension-core/     # Shared base classes + workflow engine
├── extensions/         # Always-on local extensions (package-backed extensions live in settings.json)
│   └── workflows/      # Workflow extensions (TDD, triage, etc.)
├── optional-extensions/ # Opt-in local extensions (loaded via `-e`)
├── themes/             # UI themes
├── settings.json       # Base template (packages rendered via Nix)
└── keybindings.json
```

## Syncing & Runtime

**pi-subagents** powers agent execution:
- Package install: bundled as this package's hard dependency and loaded via the Pi manifest
- Dotfiles/Home Manager install: may still install `npm:pi-subagents` separately
- Agent discovery: bootstrapped symlinks from `agent/subagents/` into `~/.pi/agent/agents/`
- Chain discovery: bootstrapped symlinks from `agent/subagents/*.chain.md` into `~/.pi/agent/chains/`

**prompt-composer** is loaded as part of this package, and may also be installed separately in dotfiles-managed setups:
- Bundled dependency source: `git+ssh://git@github.com/JordanForeman/pi-prompt-composer.git#1ccb7c4e2d9d491035bb456e9e99222d07f53d23`
- It composes runtime guidance from the synced `agent/skills/**/SKILL.md` metadata.

### Inheritance chain (work machine)

```text
1. git@github.com:JordanForeman/pi-agent.git # Version-controlled base
        ↓
2. ~/.pi/agent/                 # Machine base (dotfiles + local additions)
        ↓
3. ~/.pi/agent-work/            # Active profile (work overrides)
```

`agent-work/settings.json` is reconciled from machine-generated defaults, so shared package policy is defined in Nix and applied consistently.

## Making Changes

Edit inside this repo, then apply Home Manager for the target machine:

- Agent definitions: `agent/subagents/*.md`
- Prompt templates: `agent/prompts/{ship,analyze,plan,learn}/*.md`
- Skills: `agent/skills/{guides,conventions,formats,standards}/**/SKILL.md`
- Workflow extensions: `agent/extensions/workflows/*.ts`
- Extension core: `agent/extension-core/**`
- Local always-on extensions: `agent/extensions/**`
- Themes: `agent/themes/*.json`

## Operational Workflows

Use `/build <objective>` for normal feature work. It runs a bounded in-flight implementation loop:

```text
planner → builder → parallel reviewers → synthesis → builder fix pass → re-review (max 3 fix rounds) → final summary
```

The loop keeps implementation and fix phases to a single writer (`builder`) while parallel review remains read-only. Review synthesis emits one of `BUILD_CLEAN`, `BUILD_FIXES_NEEDED`, or `BUILD_BLOCKED` to decide whether to fix, produce a blocked final summary for a user decision, or finalize cleanly.

`/review` remains the post-hoc diff review command (`pr-review.ts`); it should not mutate files. Keep `/review` and `/build` separate: review reports on existing changes, build is allowed to create or revise changes through the review loop.

The build-specific phase prompt/spec lives in `agent/extensions/workflows/build.workflow.json`; the shared review contract used by both `/build` and `/review` lives in `agent/extension-core/review.workflow.json`. `build.ts` only loads those specs and supplies transition logic. Phase tasks are already delegated to subagents by `WorkflowEngine`, and the JSON specs explicitly attach relevant standards/conventions skills to each phase.

### Durable multi-increment mode (Ralph)

`/ralph:start <objective> --iterations N` is the older durable multi-increment workflow:

```text
ralph-groomer → ralph-worker (up to N sequential increments) → ralph-summarizer
```

Treat `/build` as the default operational paradigm for feature work. Use Ralph only when you explicitly want durable `.pi/ralph/` artifacts, a backlog/progress ledger, or multiple autonomous increments across a longer-running objective. The Ralph surface is a compatibility/long-running mode and should converge toward the same build vocabulary over time.

## Troubleshooting

### Agents not found

```bash
ls -la ~/.pi/agent/agents
```

### Package not loaded

Check settings include the package source:

```json
"packages": [
  "git:git@github.com:JordanForeman/pi-agent.git@main"
]
```

For local checkouts, run `npm install` in the repo if bundled plugin resources or symlink bootstrapping are missing.

### Latest GPT models unavailable

Use the provider that matches your auth:

- **ChatGPT subscription** → `/login` and choose **OpenAI Codex** (`openai-codex` provider)
- **OpenAI Platform API** → set `OPENAI_API_KEY` (or `auth.json` entry `openai`)

Quick checks:

```bash
pi --list-models openai-codex
pi --list-models openai
```

If `openai` requests fail with quota/billing errors, update the OpenAI Platform API key or billing/project limits.

### Work-only MCP tools not loading

Ensure machine-local files still exist under `~/.pi/agent/` (not managed by this repo):

- `extensions/mcp-bridge/`
- `bin/*-mcp-cli`
- `secrets/*`
