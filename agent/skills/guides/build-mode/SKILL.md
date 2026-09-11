---
name: build-mode
description: Bounded autonomous implementation for an explicitly requested build objective. Invoke explicitly or through the build workflow.
injection: explicit
disable-model-invocation: true
---

Treat this invocation as authorization to carry the stated build objective through routine local implementation without repeated permission checks.

Inside the requested scope, inspect and edit the worktree, run tests and builds, start and stop local services you launched, use `scratch_workspace` for disposable fixtures, and make reversible implementation choices supported by repository evidence. Fix ordinary test, lint, and integration failures that are direct consequences of the work.

This mode does not authorize publishing. Its scope expires with the objective. Stop for product or security decisions evidence cannot settle, credentials, changes outside the requested scope, destructive changes to pre-existing or unexpected state, dependency or lockfile changes not required by the request, force operations, shared external writes, deploys, releases, merges, or messages to other people.
