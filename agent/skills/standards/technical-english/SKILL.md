---
name: technical-english
description: Authoring a durable written artifact — PR description, commit body, tech doc, runbook, ADR, issue, or code comment — where sentence-level clarity and one-word-one-meaning discipline reduce ambiguity for readers and translators.
injection: classify
---

Apply a controlled-English discipline to authored artifacts. The goal is the aerospace-manual goal: a reader (or a translator, or a future agent) gets one meaning on the first pass, with no re-reading. This is the sentence layer. `concise-output` decides *which sentences survive* and how the document is laid out; this skill decides *how each surviving sentence is built*. The two compose — run both.

This governs **authored artifacts**, not conversational reasoning. Do not force these rules onto chat analysis, tradeoff discussion, or design debate — discursive prose needs subordinate clauses and nuance, and stripping them loses signal. `concise-output` owns that register.

### Sentence rules

- **One instruction per sentence** in procedures. Split compound steps.
- **Keep dependencies local.** Put the actor near the action and a qualifier near what it modifies. Split a sentence when its main relationship becomes hard to hold in memory.
- **Use active voice when the actor matters.** Do not force active voice when it creates an unnatural subject and verb pairing.
- **Use literal, conventional predicates.** Prefer “the edge case causes an error” to “the edge case bites.”
- **Present tense** for how things behave. "The consumer drops the event," not "the event will be dropped."
- **Imperative for instructions.** "Run the migration," not "the migration should be run" or "you would run."
- **Do not compress by dropping words.** Keep articles, connectives, and clause markers when they help a reader parse the sentence.

### One word, one meaning

- Pick one term for a concept and keep it for the whole artifact. Do not rotate synonyms to sound varied — in technical writing, a new word signals a new thing.
- Use the established domain term. Words such as `remove`, `delete`, and `drop` can name different operations.
- Prefer a familiar, specific verb. Avoid turning a noun into a novel verb when a conventional phrase is clearer.
- When a concept recurs, keep its name stable instead of rotating synonyms for variety.

### Structure

- **One topic per paragraph.** Keep paragraphs short — roughly ≤6 sentences.
- **Warnings and cautions come before the step they guard**, never after. A reader must see the risk before the action.
- **Use a vertical list** for a sequence of steps or a set of conditions. Do not bury a multi-part condition inside one sentence.
- **Lead with the outcome or the action**, then the detail. Same instinct as `concise-output`'s answer-first shape.

### Quotation is a factual claim

When you put text inside quote marks, you assert it appears that way in the source. Verify the string verbatim before publishing it.

- Speech is disfluent. Smoothing filler and false starts produces a cleaner sentence that the person never said. Label it as a paraphrase or a summary instead of quoting it.
- Splicing across a gap needs an ellipsis. Joining two halves of a sentence and dropping the words between them changes what was said.
- A garbled or ambiguous term in a transcript stays marked unresolved. A confident-sounding decoding written into a durable note becomes fact to every later reader, and the plausible reading is often the wrong one.
- A document's creation time is not the event's time. Deriving a sequence of events from artifact timestamps invents a narrative the artifacts do not support.

### Where this lands

- **PR descriptions / commit bodies** — pair with `pr-descriptions`, which owns what to include and exclude. This skill governs the prose style of what remains.
- **Code comments** — pair with `comments`, which owns whether a comment earns its place. This skill governs how the surviving comment reads.
- **Docs, runbooks, ADRs, issues** — full application. These are the artifacts STE was built for.

### Density is structural, not just lexical

An artifact can be accurate and still fail its reader. When prose reads as dense or as generated filler, cutting words is only half the fix — the other half is restructuring so the reader does not have to translate. Size the artifact to the complexity of the thing it describes: a straightforward task does not earn a long body, and an option menu belongs collapsed into one decision point with only the load-bearing evidence retained.

These standards govern the **published artifact body**, not only the summary you write about it in chat. When feedback says an artifact is too verbose, revise that artifact rather than only shortening the chat summary.

If a rule here fights legibility for a specific sentence, legibility wins.
