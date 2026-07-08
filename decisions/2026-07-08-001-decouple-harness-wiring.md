# 2026-07-08-001: Decouple harness wiring from portable skill/prompt content

## Context

The `pi-agent` repo is consumed by multiple harnesses, not just Pi. Portable
content (standards, conventions, prompt intent) had leaked Pi-specific execution
wiring into skill/prompt **bodies**: named subagents (`git-ops`), the `subagent`
tool, and slash-command topology (`/run`, `/chain`, `/parallel`). Any consumer
fetching a body saw Pi internals it cannot honor. Treat every harness as
interchangeable — no consumer gets special framing in the repo.

## Decision

Bodies state portable *intent*; frontmatter carries harness *wiring*.

- `subagents:` / `workflow:` frontmatter is the delegation seam. It is inert to
  core Pi prompt templates (which support only `description` / `argument-hint`
  per `docs/prompt-templates.md`) and inert to other harnesses; it is consumed
  by the pi-subagents / workflow extensions.
- Rewrote bodies to remove named harness internals:
  - `ship/quick-pr.md`, `ship/quick-commit.md`: "delegate to `git-ops`" ->
    "through your git specialist path".
  - `analyze/arch.md`, `learn/learn.md`: replaced `subagent`-tool JSON blocks
    with neutral intent prose; `subagents:` frontmatter carries the wiring.
  - `plan/plan.md`: dropped `/parallel` mention -> "optional parallel split".
  - `conventions/worktree`: "delegate to the git-ops subagent" -> neutral.
  - `conventions/core`: dropped the `tool-usage`/topology pointer.
- Split `conventions/tool-usage`: portable engineering taste stays; the concrete
  Pi mechanism (`/run`, `/chain`, `/parallel`, `subagent`) moved to a new
  Pi-only skill `conventions/delegation-topology`.

## Rejected alternatives

- **New `delegate:` frontmatter field** (earlier proposal). Rejected: `subagents:`
  already exists, is validated by `validate-taxonomy.mjs` cross-references, and is
  the established wiring channel. A second field would be redundant.
- **A harness-named skill category (e.g. `river/`)**. Rejected: `validate-taxonomy.mjs`
  hard-rejects any category outside `guides|conventions|formats|standards`
  (skills) and `ship|analyze|plan|learn` (prompts). Harness-specific framing in
  this public repo is also exactly what the discretion gate should flag — every
  harness is just another consumer.
- **Salvaging `analyze/review`, `plan/triage`, `conventions/git-attribution`,
  `guides/dream`**. Rejected: these are Pi wiring end to end, not tangled content.
  Their bodies naming harness internals is correct — the wiring lives in a
  harness-specific artifact by design.

## Validation

`node agent/scripts/validate-taxonomy.mjs` passes. Zero harness-internal names
remain in portable content bodies (conventions/standards/formats/prompts);
remaining matches are the intended `subagents:` frontmatter overlay and the
Pi-only `delegation-topology` skill.

## Residual coupling (accepted)

`conventions/delegation-topology` is `injection: always` and names Pi mechanisms
(`/run`, `/chain`, `/parallel`, `subagent`) in its body. This is correct for Pi
and safe for other harnesses, which fetch specific files by pointer rather than
walking `conventions/*`. The body self-labels as "Pi wiring / Pi-specific" so a
pointer author sees it is not portable. The only leak path is a misconfigured
pointer aimed directly at this file — a pointer-discipline concern, not a
content-decoupling one.
