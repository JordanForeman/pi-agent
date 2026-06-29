# Pi Agent Configuration

This directory contains the shareable Pi configuration synced across Jordan's machines.

> For package/extraction wiring, see the dotfiles repository; this repo owns the Pi agent resources themselves.

## Installation

Install directly from GitHub:

```bash
pi install git:git@github.com:JordanForeman/pi-agent.git@main
```

For a local checkout, install dependencies first so the bundled `pi-subagents` package and postinstall bootstrap are available, then install the package path:

```bash
git clone git@github.com:JordanForeman/pi-agent.git
cd pi-agent
npm install
pi install "$PWD"
```

The `postinstall` script symlinks Markdown files under `agent/subagents/` into `~/.pi/agent/agents/` and `*.chain.md` files into `~/.pi/agent/chains/` for `pi-subagents` discovery. It respects `PI_CODING_AGENT_DIR` when set. Pi settings and keybindings are not installed by the package; they remain dotfiles/Home Manager concerns.

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

**prompt-composer** is installed as an external Pi package in the dotfiles-managed setup:
- Source: `git:git@github.com:JordanForeman/pi-prompt-composer.git@1ccb7c4e2d9d491035bb456e9e99222d07f53d23`
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

## Ralph v2 Workflow

`/ralph:start <objective> --iterations N` runs a compact WorkflowEngine flow:

```text
ralph-groomer → ralph-worker (up to N sequential increments) → ralph-summarizer
```

The parent Pi session only schedules phases and receives compact receipts/signals. Worker internals (planning, recon, implementation, validation, and history updates) stay inside `ralph-worker` and durable `.pi/ralph/` artifacts.

Exposed commands are intentionally small: `/ralph:start`, `/ralph:status`, `/ralph:stop`, and `/ralph:report`. Start creates/updates required `.pi/ralph/` state automatically.
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

For local checkouts, run `npm install` in the repo if `pi-subagents` resources or symlink bootstrapping are missing.

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
