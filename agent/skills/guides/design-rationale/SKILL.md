---
name: design-rationale
description: Investigate why existing code acquired its shape using cited historical evidence and explicit uncertainty
injection: explicit
---

Anchor the question to concrete files, symbols, and line ranges. First explain current mechanics separately from any claim about historical intent; present code shape alone does not prove why it exists.

Search the closest local evidence first: tests and comments, `git blame`, `git log --follow`, and `git show`. Use `gh` for relevant PR or issue context only when available and authorized. Consult other issue, document, chat, observability, or analytics sources only when they are relevant, available, and permitted; do not fan out by default or expose private material in public artifacts.

Classify findings as direct evidence, reasonable inference, competing hypothesis, contradiction, null result, or unknown. Cite where each claim came from and state how it was obtained. Missing records and conflicting accounts are findings, not permission to invent a tidy story.

When the investigation informs a future change, conclude with constraints to preserve, change, avoid, and verify. Report using `evidence-report`; callers that require that format must inject it explicitly because skill references are not transitive.
