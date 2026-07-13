---
name: data-modeling
description: Designing or changing how a domain concept is persisted — schema, identity, mutability, deletion, and history — where the storage shape encodes safety and truth
injection: classify
---

A data model is a set of promises about what can happen to a fact once it's recorded. Those promises are made *once*, at design time, and every future operation inherits them. When you shape a model, you are deciding — often silently — what is recoverable, what is auditable, and what is true. This taste applies when you're *shaping persistence*, not on every query.

### Model the domain before the storage

- Interrogate the concept before choosing columns. What *is* this thing — an event that happened, a mutable current state, or a projection of other facts? The answer dictates the shape.
- A field that holds categorically different kinds of values (a status *and* a computed result in one column) is a modeling failure wearing a schema. Separate the concepts; don't union them into one slot.
- Prefer honest shapes: a bare domain type and a truthful "absent" over wrapper objects or null-objects that quietly swallow the difference between *empty* and *unknown*. Absence should be legible, not disguised.

### Reversibility is a deliberate decision, not an accident

The reversibility of an operation should be a deliberate modeling decision made when the model is designed — not an accident of which safeguard someone remembered to add. Irreversible operations should require justification; reversible ones should be the default.

- **Structural safety over procedural safety.** A safeguard that lives in the author's head and this review ("I reasoned carefully") starts every future change from zero. A safeguard that lives in the schema ("the record is recoverable by construction") makes correctness the default. Prefer the construction.
- Destructive-then-reconstructive operations stack two irreversibilities: an interrupt mid-operation leaves the old value gone and the new one never written. Make the old value recoverable *before* writing the new one.
- Recoverability is not free. It complicates every read (you now filter out the invisible rows), risks uniqueness collisions (scope uniqueness on the "still-live" predicate), and can become a retention/privacy liability. The point is not "make everything reversible" — it's that reversibility is a *choice you make on purpose*, weighing these costs, at design time.

### Recoverability, auditability, and history are three different guarantees

Don't conflate them — a model can have one without the others:

- **Recoverability** answers *can I get the fact back.* (Logical deletion, restore paths.)
- **Auditability** answers *who changed it, when, and why.* Recoverability alone tells you the row is gone but not who removed it or under what intent. If the "why" matters, emit a deletion/mutation record (actor, timestamp, reason, originating operation) — the recoverable row won't carry that by itself.
- **History** answers *what were all the prior values.* Some domains (anything ledger-like — money, entitlements, policy decisions) should be append-only: you record a new fact rather than overwriting the old one. Overwriting throws away the audit trail the domain implicitly needs.

For domains where the past matters, prefer **storage as an append-only ledger, current state as a computed projection** over in-place mutation. This preserves reproducibility, makes non-destructive experimentation possible, and lets you re-derive different views without losing the original facts.

### Silent-wrong beats loud-correct only by accident — design against it

The most dangerous data bug is the one that turns a wrong state into a *permissive* one without failing. If deleting a restriction record makes the system behave as "no restriction applied," a bad delete doesn't error — it silently grants access it shouldn't. When absence has a policy meaning, make the model distinguish *"intentionally none"* from *"missing/unknown,"* so a mistake fails loud instead of defaulting open.

### Understand the blast radius of a write

- A change to a widely-shared or globally-scoped table is not local. Know whether a bad batch reaches one tenant or the whole system before you design the migration.
- Persistence changes usually fan out — cached reads, downstream projections, change-data-capture consumers. A hard delete and a logical delete produce *different* signals to those consumers (a vanished row vs. a tombstone with context). Design the change knowing who observes it.
- For burst/backfill writes, append-only shapes are gentler on downstream capture: a row written once and never updated emits at most one change event in its lifetime.

### Most "technical debt" here is modeling debt

When a model feels wrong but you can't say how to fix it, the usual cause is that the *product* hasn't yet discovered how the concept should be modeled. The response is to **preserve optionality** — avoid baking in an irreversible or lossy shape — not to annotate the gap and move on. The cheapest time to get reversibility, identity, and history right is before the first row exists; the most expensive is after a million do.
