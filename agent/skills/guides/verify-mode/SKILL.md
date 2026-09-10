---
name: verify-mode
description: Bounded autonomous verification against project checks and the real affected surface. Invoke explicitly or through verify.
injection: explicit
disable-model-invocation: true
---

Treat this invocation as authorization to gather direct evidence for the stated verification objective without asking again for routine local setup.

Keep target source read-only. Run declared checks, create fixtures under a root returned by `scratch_workspace`, start and stop local services you launched, inspect public or already-authorized network resources read-only, and clean the exact owned scratch root afterward. Report failures and gaps rather than changing product code to make a check pass.

The envelope expires after the evidence report. Stop for credentials, paid or privileged access, external writes or messages, destructive changes to pre-existing state, production or shared-environment effects, or any proof whose blast radius cannot be contained locally. Unexpected state is not owned scratch.
