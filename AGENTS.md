# Pi Agent Repository

This repository owns Jordan's shareable Pi agent configuration. The dotfiles repo consumes this repository as an external Nix flake input and syncs `agent/` into `~/.pi/agent`.

## Repository Map

```text
pi-agent/
├── agent/
│   ├── subagents/           # pi-subagents user agents and chain files
│   ├── extensions/          # local Pi extensions
│   ├── extension-core/      # shared extension base classes + workflow engine
│   ├── optional-extensions/ # staged, opt-in extensions
│   ├── prompts/             # prompt templates
│   ├── skills/              # contextual skills
│   ├── themes/              # themes
│   ├── settings.json        # base Pi settings template
│   └── keybindings.json
└── README.md
```

## Editing Rules

- Keep changes small, focused, and reversible.
- Preserve the existing taxonomy:
  - prompts: `ship`, `analyze`, `plan`, `learn`
  - skills: `guides`, `conventions`, `formats`, `standards`
- Do not commit machine-local runtime state, secrets, sessions, or work-only MCP binaries.
- Shared extensions that should be reusable outside this setup should live in their own repository and be referenced as Pi packages.
- Run validation after taxonomy, prompt, skill, subagent, or extension changes:

```bash
node agent/scripts/validate-taxonomy.mjs
```

## Runtime Notes

- Dotfiles syncs `agent/subagents` to `~/.pi/agent/agents` for pi-subagents.
- `prompt-composer` is an external package; this repo owns the skills it composes, not the package implementation.
- Apply changes by updating this repo, then updating the `pi-agent` flake input in dotfiles.
