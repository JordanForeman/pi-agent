---
description: Create a single high-signal commit from current changes
subagents: [git-ops]
---
Create one commit for the current changes. This explicit `/quick-commit` invocation authorizes one scoped commit containing only the current objective's reviewed files, without a second confirmation.

Workflow:
1. Inspect repository state, attribution, staged and unstaged diffs, and relevant validation.
2. Separate files belonging to the current objective from unrelated or unexpected state.
3. Draft a conventional commit message that explains why.
4. Perform the scoped stage, staged-diff verification, and commit through the git specialist path.
5. Return the commit hash, branch, and post-commit status.

Never amend, bypass hooks, include unrelated files, overwrite existing work, rewrite history, or write to a protected or shared branch. Stop for destructive changes, credentials or secrets, merge/deploy/release actions, or ambiguity about ownership or scope. This authorization expires after the requested commit.
