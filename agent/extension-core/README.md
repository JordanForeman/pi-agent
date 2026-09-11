# Extension Core

Shared base classes and the workflow engine. See root `AGENTS.md` for repository guidance and `WORKFLOW-ENGINE-DESIGN.md` for the runtime contract.

## WorkflowEngine API Reference

`workflow-engine.ts` — the shared coordination engine for workflow extensions.

### Key types

```typescript
WorkflowDefinition  // Declares phases, transitions, subagent assignments
PhaseDefinition     // One phase: id, label, execution mode, tasks, transition rule
PhaseTask           // One unit: agent + mandatory requires metadata + task template
WorkflowContext     // Accumulated state: input, phase results, current phase, state
```

### Task capability contract

Every inline task literal must put `requires` immediately after its static `agent` name. JSON-backed task specs use the same fields, and their loaders validate and forward the array. It declares the capabilities the selected agent needs (`filesystem-write`, `shell`, or neither). Repository semantic validation checks that the agent exists and declares every required capability; runtime dispatch does not grant capabilities.

```typescript
{
  agent: "builder",
  requires: ["filesystem-write", "shell"],
  task: "Implement and verify: {input}",
}
```

### Phase execution modes

- `sequential` — tasks run one at a time
- `parallel` — all tasks are requested in one parallel `subagent` dispatch; the engine records one completion per child result

### Transition rules

- `advance` — proceed to the next phase after success; a failed phase ends the workflow
- `conditional` — `decide(result, context)` returns next phase id or null to end
- `loop` — `until(result, context, iteration)` returns true when done

### Task template placeholders

- `{input}` — original user input
- `{context}` — formatted accumulated findings from all completed phases
- `{phase:<id>}` — output from a specific completed phase

## Design goals

- Extension entrypoints should be thin and consistent
- Workflow definitions should be pure configuration — the engine handles all mechanics
- Subagent dispatch is abstracted inside the engine (currently `pi-subagents`; swappable)
