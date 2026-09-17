---
name: build-mode
description: Bounded autonomous implementation for an explicitly requested build objective. Invoke explicitly or through the build workflow.
injection: explicit
disable-model-invocation: true
---

Treat this invocation as authorization to carry the stated build objective through routine local implementation without repeated permission checks.

Inside the requested scope, inspect and edit the worktree, run tests and builds, start and stop local services you launched, use `scratch_workspace` for disposable fixtures, and make reversible implementation choices supported by repository evidence. Fix ordinary test, lint, validation, and integration failures that are direct consequences of the work.

A general objective authorizes the smallest coherent, reversible solution that satisfies it. Infer routine product, scope, UX, and architecture details from repository conventions. When several safe choices remain, choose the simplest one and record any material assumption. Do not stop merely because the request omitted implementation details or because several reasonable options exist.

This mode does not authorize publishing. Its scope expires with the objective. Stop only when evidence cannot settle a consequential product or security decision safely, requirements conflict, or progress requires credentials, changes outside the requested scope, destructive changes to pre-existing or unexpected state, ambiguous ownership, dependency or lockfile changes not required by the request, force operations, protected or shared writes, deploys, releases, merges, or messages to other people.
