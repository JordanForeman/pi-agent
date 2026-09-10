---
name: validation-discovery
description: Discover project checks and verify changed behavior on its real affected surface
injection: detect
detect:
  mode: write
---

Validation has two distinct tracks.

### Project contract

Discover what this project declares, in order:

1. `AGENTS.md` or `CLAUDE.md` validation instructions.
2. Conventional runners such as `Makefile`, `Justfile`, `package.json` scripts, or `bin/` commands.
3. CI configuration such as `.github/workflows/` or `.buildkite/`.
4. Language defaults only when no higher-authority contract exists.

Run focused checks first, then broader declared checks when appropriate.

- Build or typecheck with the configuration the project's build script actually uses, not a raw compiler default that can pull in unrelated files.
- Require tests for new behavior per `test-first`; this is engineering discipline, not inferred project policy.
- Leave no debug artifacts and do not broaden public APIs solely to enable testing.
- Time-box costly checks. Redirect long-running output to an artifact so a stall remains visible, and defer to CI when local provisioning costs more than the signal is worth.
- Validate ad hoc checkers against one known-bad and one known-good case before trusting their output.
- Scope findings to changed lines. When repository-wide checks are noisy, use a minimal configuration for the changed subtree rather than abandoning verification.

Separate targeted failures from unrelated environment, tooling, or pre-existing failures. Report both; do not let ambient drift erase a meaningful scoped pass, and do not call the whole project green.

### Behavioral proof

Identify the changed UI, CLI/TUI, service/API, integration, or library-consumer path and exercise that same surface when practical. Compilation, typechecking, a build, source inspection, CI status, or another agent's summary can support confidence but cannot alone verify changed runtime behavior.

For every check, retain the exact command, exit status, observed output, and artifact pointer when one exists. Report project checks separately from real-surface observations using `evidence-report` verdicts: `VERIFIED`, `NOT VERIFIED`, or `INCONCLUSIVE`, with individual residual claims marked `UNVERIFIED` where appropriate. Honest abstention is not a pass.

If the required surface is unavailable or a check would be unsafe, state why, what was established instead, and the next cheapest direct check. Do not invent a validation contract.
