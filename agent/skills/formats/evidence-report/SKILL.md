---
name: evidence-report
description: Report a claim or outcome with reproducible evidence, verdict, cleared concerns, and residual risk
injection: explicit
---

Use this compact record wherever another guide or role requests evidence:

- **Claim or outcome:** the precise statement being assessed.
- **Verdict:** `VERIFIED`, `NOT VERIFIED`, `INCONCLUSIVE`, or `UNVERIFIED`.
- **Direct evidence:** what was observed and how; include the exact command and exit status, or a durable artifact, file, or URL pointer.
- **Cleared concerns:** plausible concerns the evidence ruled out.
- **Residual risks or gaps:** what the evidence did not establish and the next cheapest useful check.

`VERIFIED` requires direct evidence supporting the stated claim. `NOT VERIFIED` means an executed check contradicted it or the expected behavior was absent. `INCONCLUSIVE` means a check ran but tooling, environment, or ambiguity prevented a decision. `UNVERIFIED` means a residual claim was not directly checked. Never promote source inspection, compilation, or another agent's summary beyond what it actually proves.
