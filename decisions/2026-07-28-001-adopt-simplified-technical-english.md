# 2026-07-28-001: Adopt ASD-STE100 Simplified Technical English for authored artifacts

## Context

Jordan asked whether ASD-STE100 Simplified Technical English (STE) — the
controlled natural language from aerospace maintenance manuals (writing rules +
one-word-one-meaning dictionary) — could be the default communication mode for
his agentic harnesses via `pi-agent`. Not all his harnesses run Clio; the
content must stay portable.

STE is a *checkable spec*, which is its appeal over "write clearly." But it was
built for procedures. It fits authored, procedural, reference artifacts (PRs,
commits, docs, runbooks, ADRs, issues, comments) strongly, and fits discursive
chat reasoning badly — forcing <=20-word imperative sentences onto tradeoff
analysis strips the subordinate clauses that carry nuance. That failure mode is
exactly what `concise-output` already guards ("legibility wins ties"; "write for
a smart colleague, not a compiler").

STE and Tufte/`concise-output` operate at different layers and compose:
`concise-output` is the document layer (signal-to-ink, layout, what to cut);
STE is the sentence layer (active voice, present tense, one instruction per
sentence, one word one meaning).

## Decision

Two changes, chosen from a 4-way scope menu (Jordan picked "scoped + light
always-on sentence hygiene"):

1. New skill `standards/technical-english` (`injection: classify`). Carries the
   load-bearing, transferable STE subset — short sentences, active voice, present
   tense, imperative instructions, one-instruction-per-sentence, one-topic
   paragraphs, warnings-before-steps, vertical lists, and one-word-one-meaning as
   a principle plus a tiny illustrative term habit. Scopes itself to authored
   artifacts and explicitly excludes conversational reasoning. Cross-references
   `concise-output`, `pr-descriptions`, `comments` so the standards compose
   rather than collide. Body is written in STE to dogfood it. Body is pure
   portable substrate — STE is harness-neutral by nature, so it travels to River
   and other non-Clio consumers cleanly.

2. Light always-on amendment to `standards/concise-output`: a 3-line
   sentence-hygiene block (active voice, one instruction per sentence, one word
   one meaning) framed as gentle defaults, not gates, deferring to
   `technical-english` for durable artifacts and to legibility on ties.

## Rejected alternatives

- Full always-on STE default communication mode (menu option 3). Rejected:
  would STE-ify chat reasoning and fight `concise-output`'s "legibility wins
  ties." STE-ified analysis reads like a robot and loses nuance.
- Import the complete ASD-STE100 spec (~53–65 rules + ~900-word aerospace
  dictionary). Rejected: over-fit to bolts and hydraulics. Adopt the transferable
  subset and the one-word-one-meaning principle, not the domain lexicon.
- Scoped-only, no always-on hygiene (menu option 1). Rejected by Jordan in
  favor of also tightening every sentence via the light `concise-output`
  amendment.

## Validation

`node agent/scripts/validate-taxonomy.mjs` passes. New skill has valid
frontmatter (name matches dir, `injection: classify`, non-empty body).

## Residual notes

Portability is limited only by injection, same as every skill here: Pi honors
`injection: classify`; non-Pi harnesses that consume `pi-agent` need a pointer to
the file. The body itself is harness-neutral.
