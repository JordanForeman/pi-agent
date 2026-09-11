---
name: ship-mode
description: Scoped authorization for routine commit and pull-request publication requested through quick ship commands. Invoke explicitly.
injection: explicit
disable-model-invocation: true
---

An explicit `/quick-commit` invocation authorizes one commit containing only the current objective's reviewed files. An explicit `/quick-pr` invocation authorizes the same scoped commit when needed, a normal push of the current topic branch, and creation or update of its current pull request. An explicit `/vibe` invocation additionally authorizes creating or selecting one local topic branch before implementation, then publishing the clean reviewed result as a pull request. Direct `/skill:ship-mode <exact commit or PR objective>` invocation grants the corresponding bounded authorization. Do not ask again for those exact actions.

Inspect branch, worktree, attribution, diff, and validation before acting. Exclude unrelated or unexpected files and report them. The authorization expires after the requested commit or pull-request update.

Stop for force pushes, history rewrites, protected or shared branch writes, merge, deploy, release, credentials, secrets, destructive changes to pre-existing state, messages beyond the pull request itself, or ambiguity about which changes belong to the request. This mode is not approval for later publishing work.
