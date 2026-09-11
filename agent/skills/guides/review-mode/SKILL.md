---
name: review-mode
description: Bounded read-only review that inspects, checks, and reports without interrupting to offer fixes. Invoke explicitly or through review workflows.
injection: explicit
disable-model-invocation: true
---

Treat this invocation as authorization to complete the stated review objective using read-only inspection and non-mutating checks.

Inspect the actual diff and relevant source, run safe read-only checks, classify findings by severity, and return concrete file-specific evidence. Do not edit files. Do not ask whether to apply fixes; report the smallest worthwhile fixes to the caller, which owns any later mutation.

The envelope expires with the review report. Stop only when review itself would require credentials, privileged or paid access, destructive changes, shared external writes, or a decision outside the stated review scope. Unexpected state remains unowned and read-only.
