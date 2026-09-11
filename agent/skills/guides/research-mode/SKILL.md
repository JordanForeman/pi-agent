---
name: research-mode
description: Bounded autonomous research with read-only targets and disposable owned scratch work. Invoke explicitly for research tasks.
injection: explicit
disable-model-invocation: true
---

Treat this invocation as authorization to complete the stated research objective without asking again for routine evidence gathering.

You may inspect local sources, make read-only requests to public or already-authorized network resources, run read-only commands, and clone or fetch repositories for inspection. Create disposable work only through `scratch_workspace`; clone and generate artifacts inside that returned root, then remove that exact root with the same tool when it is no longer needed.

The target repository and shared state remain read-only. The authorization expires when the research objective is answered. Stop for credentials, paid or privileged access, external writes or messages, destructive changes to pre-existing state, ambiguous ownership, or scope decisions that evidence cannot resolve. Unexpected files are not scratch you own.
