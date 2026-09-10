---
description: Verify a change against project checks and its affected real surface
subagents: [code-explorer]
---
Verify `$@` while keeping target source and shared state read-only. Use project-defined checks first, exercise the real affected surface when practical, and return exact commands, exit status, direct observations, a verdict, residual gaps, and the cheapest next check.

Disposable setup is authorized only through `scratch_workspace`; work inside the returned root and remove that exact root when finished. Do not install dependencies, edit target files, publish externally, or use generic destructive cleanup. Stop if verification requires target mutation, credentials, secret access, destructive action, or a product/scope decision.

When the `/verify` workflow extension is loaded, its deterministically injected command takes precedence over this self-contained prompt fallback.
