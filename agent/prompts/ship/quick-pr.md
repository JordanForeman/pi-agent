---
description: Prepare changes and open or update a pull request safely
subagents: [git-ops]
---
Publish the current work as a pull request. This explicit `/quick-pr` invocation authorizes a scoped commit when needed, a normal push of the current topic branch, and creation or update of its current pull request without a second confirmation.

Workflow:
1. Inspect branch, worktree, attribution, and diff scope versus the default branch.
2. Separate current-objective files from unrelated or unexpected state and run relevant validation.
3. Perform scoped staging, commit creation when needed, and a normal topic-branch push through the git specialist path.
4. Create or update the current pull request with a concise title, summary, and verification evidence.
5. Return the pull-request URL and what was published.

Do not force push, rewrite history, write to a protected or shared branch, merge, deploy, release, expose secrets, send messages beyond the pull request, make destructive changes to pre-existing state, or include unrelated files. Stop when ownership or scope is ambiguous. This authorization expires after the requested pull-request update.
