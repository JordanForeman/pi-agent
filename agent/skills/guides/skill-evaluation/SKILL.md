---
name: skill-evaluation
description: Compare skill or prompt activation and behavior with isolated, blinded, transcript-backed evidence
injection: explicit
---

Evaluate one stated behavior with 3–6 observable criteria. Treat two questions separately: **activation** asks whether the intended skill appears for positive requests and stays absent for negative requests; **behavior** asks whether it materially improves the result against the rubric.

For a behavioral comparison:

1. Create independent temporary directories or worktrees from the same starting state. Fresh conversation context does not isolate writable files.
2. Give control and candidate runs the same natural request. Do not reveal the rubric, variant identity, or that a comparison is underway.
3. Select available models at invocation time through `pi-subagents`; never encode provider or model slugs here. Use top-level fresh context, distinct `cwd` and output paths, artifacts enabled, and sharing disabled.
4. Randomize neutral candidate labels before one judge scores every anonymized output on one rubric and scale.
5. Inspect only transcripts, files read, diffs, commands, exit statuses, and artifacts created in the candidate/judge directories and output paths for this evaluation. Never search unrelated session directories or inspect transcripts from other runs; assess compliance from the isolated evaluation artifacts rather than asking candidates whether they complied.
6. Compare the judge's result with the lead review and report disagreement and limitations.
7. Remove only disposable artifacts created for the evaluation; retain evidence needed for review.

For activation, use `/prompt-debug` positive and negative probes. If automatic classification is disabled, record that classify-only activation is unavailable and test explicit `/skill:<name>` invocation instead; do not infer activation from output quality.

Report with `evidence-report`, including neutral artifact pointers, rubric scores, candidate mapping kept outside candidate prompts, and isolation limits. The caller must inject the format explicitly.
