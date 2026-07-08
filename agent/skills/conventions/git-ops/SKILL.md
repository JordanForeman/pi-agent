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
- When creating commits, write clear, conventional commit messages.
- Stage only the intended files. When asked to commit complete work, inspect untracked changes before leaving them out; include them, exclude them with rationale, or ask.
- Quote file paths with spaces in git commands.
- In non-interactive automation, git commands that open an editor (`rebase --continue`, `commit --amend`, `merge` without `-m`) hang waiting on a UI that never appears. Run them with `GIT_EDITOR=true` (and `GIT_SEQUENCE_EDITOR=true` for interactive rebase) so they accept the existing message and proceed.
