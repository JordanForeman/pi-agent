---
name: technical-english
description: Authoring a durable written artifact — PR description, commit body, tech doc, runbook, ADR, issue, or code comment — where sentence-level clarity and one-word-one-meaning discipline reduce ambiguity for readers and translators.
injection: classify
---

Apply a controlled-English discipline to authored artifacts. The goal is the aerospace-manual goal: a reader (or a translator, or a future agent) gets one meaning on the first pass, with no re-reading. This is the sentence layer. `concise-output` decides *which sentences survive* and how the document is laid out; this skill decides *how each surviving sentence is built*. The two compose — run both.

This governs **authored artifacts**, not conversational reasoning. Do not force these rules onto chat analysis, tradeoff discussion, or design debate — discursive prose needs subordinate clauses and nuance, and stripping them loses signal. `concise-output` owns that register.

### Sentence rules

- **One instruction per sentence** in procedures. Split compound steps.
- **Keep sentences short.** Aim for ≤20 words in instructions, ≤25 in descriptions. Length is a signal, not a hard gate — a longer sentence that stays at one level of thought is fine.
- **Active voice.** "The job retries the request," not "the request is retried."
- **Present tense** for how things behave. "The consumer drops the event," not "the event will be dropped."
- **Imperative for instructions.** "Run the migration," not "the migration should be run" or "you would run."
- **Do not compress by dropping words.** Keep articles and connectives. Clarity beats terseness — this is where STE and raw brevity diverge, and clarity wins.

### One word, one meaning

- Pick one term for a concept and keep it for the whole artifact. Do not rotate synonyms to sound varied — in technical writing, a new word signals a new thing.
- Prefer the plain, specific verb for an action and reuse it:
  - **remove** (not delete/drop/strip/purge) for taking a thing out
  - **add** (not introduce/create/wire-up) for putting a thing in
  - **run** (not execute/invoke/kick-off) for starting a command or job
  - **fail** (not break/blow-up/die) for an error path
- The point is not this exact list — it is the habit. When a concept recurs, name it once and hold the name.

### Structure

- **One topic per paragraph.** Keep paragraphs short — roughly ≤6 sentences.
- **Warnings and cautions come before the step they guard**, never after. A reader must see the risk before the action.
- **Use a vertical list** for a sequence of steps or a set of conditions. Do not bury a multi-part condition inside one sentence.
- **Lead with the outcome or the action**, then the detail. Same instinct as `concise-output`'s answer-first shape.

### Where this lands

- **PR descriptions / commit bodies** — pair with `pr-descriptions`, which owns what to include and exclude. This skill governs the prose style of what remains.
- **Code comments** — pair with `comments`, which owns whether a comment earns its place. This skill governs how the surviving comment reads.
- **Docs, runbooks, ADRs, issues** — full application. These are the artifacts STE was built for.

### Density is structural, not just lexical

An artifact can be accurate and still fail its reader. When prose reads as dense or as generated filler, cutting words is only half the fix — the other half is restructuring so the reader does not have to translate. Size the artifact to the complexity of the thing it describes: a straightforward task does not earn a long body, and an option menu belongs collapsed into one decision point with only the load-bearing evidence retained.

These standards govern the **published artifact body**, not only the summary you write about it in chat. When feedback lands on "this is too verbose," confirm which artifact is meant before revising.

Avoid the tells of generated prose. The em-dash is the loudest: prefer a colon after a bolded label lead-in, and a period or comma where an em-dash was doing a clause's work. A reader who thinks "this looks machine-written" has stopped reading the content.

If a rule here fights legibility for a specific sentence, legibility wins — same tie-breaker as `concise-output`.
