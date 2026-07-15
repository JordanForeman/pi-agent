---
name: pr-descriptions
description: Writing or updating a pull request description/body — when opening a PR, editing a PR's description, or asked what a PR should say. Governs the written artifact, not the git mechanics.
injection: classify
---

A PR description carries only what the diff and CI cannot say for themselves. Write *why the change exists and how to use it* — intent, the key design decision, and a worked example where one aids comprehension. A smart reviewer should grasp the change in one read.

### Include

- **Why** the change exists — the problem, the intent, the decision that isn't obvious from the code.
- **How to use it** — a worked example (query, call site, before/after) when it aids comprehension.
- **Non-obvious design choices** — a rejected alternative, a constraint, a deliberate scope boundary — only when a reviewer couldn't infer it from the diff.

### Exclude

- **No file-by-file / bulleted change list.** That is GitHub's "Files changed" tab; the list rots the moment the diff moves.
- **No "Testing" / "How I tested" section.** Running tests is presumed and CI is a merge gate — stating it is noise.
- **No prose that restates the diff**, generic caveats, or process narration. Signal over ceremony.

### Updating an existing PR body

Read it first, preserve its shape, and make minimal targeted edits. Never overwrite manual edits with a regenerated dump — a human may have tidied it, and clobbering that is worse than leaving it alone.

### Shape

Shorter is better as long as the *why* survives. Two sections — a short "What/Why" and an "Example" — clear the bar for most changes. Reach for more structure only when the change genuinely needs it.
