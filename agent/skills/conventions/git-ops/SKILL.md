---
name: git-ops
description: Git commit and operation best practices
injection: detect
detect:
  files: [.git]
---

- Prefer creating new commits over amending existing ones.
- Never skip git hooks (no --no-verify).
- Avoid destructive git operations (force push, reset --hard) without explicit confirmation.
- Discarding a path with `git checkout HEAD -- <file>` (or `git restore`/`git checkout <branch> -- <file>`) overwrites the working tree with the target ref and **permanently destroys uncommitted edits** to that file — there is no reflog for unstaged changes. Before discarding, confirm the change is already committed or stashed; if in doubt, `git stash` or copy the file aside first. This footgun bites hardest mid-refactor, when the valuable edits are exactly the ones not yet committed.
- When creating commits, write clear, conventional commit messages.
- Stage only the intended files. When asked to commit complete work, inspect untracked changes before leaving them out; include them, exclude them with rationale, or ask.
- Quote file paths with spaces in git commands.
- Never hand-merge generated files (schema dumps, lockfiles, codegen output) on a merge or rebase conflict. The correct resolution is to take one side wholesale, then regenerate the artifact from its source of truth so it reflects the combined state. Hand-editing generated output produces a file that matches neither input and silently drifts from what the generator would produce.
- In non-interactive automation, git commands that open an editor (`rebase --continue`, `commit --amend`, `merge` without `-m`) hang waiting on a UI that never appears. Run them with `GIT_EDITOR=true` (and `GIT_SEQUENCE_EDITOR=true` for interactive rebase) so they accept the existing message and proceed.
