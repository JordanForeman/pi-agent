---
name: api-design
description: Designing or authoring classes, types, modules, or public interfaces where surface area and design vocabulary matter
injection: classify
---

Start from realistic caller usage. Sketch how a caller should express the operation, what data it supplies, and what success or failure it receives; then shape types and signatures around that experience and reconcile the sketch with live constraints. Judge interface depth explicitly: a strong surface hides meaningful complexity without concealing behavior callers must control.

Classes, functions, modules, and data types should have clear roles and deliberate boundaries between exposed contract and hidden implementation. Apply this guidance when shaping an interface, not on every edit.

### Design vocabulary carries meaning

- Name types after what they are or the role they play: `RetryPolicy`, `OrderSerializer`, `PaymentGateway`. Generic suffixes such as `Service`, `Manager`, or `Handler` should earn their breadth.
- Use vocabulary such as facade, adapter, factory, policy, or builder only when it clarifies participation rather than adding ceremony.

### Keep the public surface cohesive

- Public operations should narrate what collaborators can ask for; internal helpers should make implementation concepts legible without being exposed by default.
- A functional module or data type can be intentionally designed without private methods. Evaluate encapsulation by leaked responsibility, not by method counts.
- Never widen the public API solely for testing. Test through a legitimate contract or restructure around a genuine collaborator.
- Prefer the smallest cohesive set of types and operations. Extract a collaborator when responsibilities or change drivers diverge, not to maximize type or file count.
- Favor clear inputs and outputs over hidden shared mutable state.
