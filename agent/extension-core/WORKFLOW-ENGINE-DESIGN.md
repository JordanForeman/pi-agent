# WorkflowEngine Design Notes

> **Status**: Reference document. The engine is implemented in `workflow-engine.ts`. This document captures the design rationale and architecture decisions. For usage instructions, see `README.md` in this directory and `extensions/workflows/README.md`.

## Purpose

The shared engine centralizes phase dispatch, bounded context, receipts, transitions,
and UI state so workflow extensions can focus on task intent. The shipped build,
TDD, triage, PR-review, and Ralph extensions all use this engine. TypeScript
definitions and their referenced workflow JSON specs remain the source of truth.

## Execution Model: Hybrid (Engine + LLM)

The engine manages lifecycle and state. The LLM executes phases by calling the `subagent` tool.

**Why hybrid?**
- Extensions can't call tools directly — only the LLM can invoke `subagent`
- `pi.sendUserMessage()` is fire-and-forget — no return value, no await
- The LLM is naturally good at interpreting results and adapting tasks
- The engine is good at deterministic state, UI updates, and enforcing structure

```
                     ┌──────────────────────────┐
                     │     WorkflowEngine        │
                     │  (extension-core)          │
                     │                            │
                     │  • Phase state machine     │
                     │  • Context accumulation    │
                     │  • UI status/progress      │
                     │  • Transition enforcement  │
                     └──────────┬─────────────────┘
                                │
                   injects structured phase
                   instructions into system prompt
                   + tracks progress via events
                                │
                     ┌──────────▼─────────────────┐
                     │       Main LLM              │
                     │                              │
                     │  Sees: "You are in phase X   │
                     │  of workflow Y. Execute by    │
                     │  calling the subagent tool    │
                     │  with agent Z and task W."    │
                     │                              │
                     │  Calls: subagent tool         │
                     │  Reports: phase results       │
                     └──────────┬─────────────────┘
                                │
                     ┌──────────▼─────────────────┐
                     │    pi-subagents (engine)     │
                     │  (community plugin)          │
                     │                              │
                     │  Executes subagent in         │
                     │  isolated sub-session         │
                     └─────────────────────────────┘
```

### How phases advance

1. **Engine** sets up workflow state and injects phase instructions via `before_agent_start`
2. **LLM** reads phase instructions, calls `subagent` tool with the right agent + task
3. **Engine** listens for `tool_execution_end` events where `toolName === "subagent"` to detect phase completion
4. **Engine** captures the subagent result, updates context, transitions to next phase
5. **Engine** sends a follow-up message with next phase instructions via `pi.sendUserMessage()`
6. Repeat until workflow completes

### What if pi-subagents goes away?

The engine's instructions tell the LLM to use the `subagent` tool. If the execution layer changes:
- Update the phase instruction template to reference the new tool/command
- Update the event listener that detects completion
- Workflow definitions don't change at all

## Architecture

```
User ──/tdd──▶ WorkflowExtension command ──uses──▶ WorkflowEngine
                           │                              │
                     declares phases,              manages lifecycle,
                     transitions,                  injects instructions,
                     subagent mapping              tracks via events,
                                                   updates UI
```

### What the engine owns (mechanics)
- System prompt injection for current phase instructions
- Event-based phase completion detection
- Phase lifecycle (enter → LLM executes → exit, with status tracking)
- Context accumulation with bounded output compaction by default
- Phase receipts (agent, status, artifact path, verdict, top findings)
- UI affordances (status bar, phase progress, notifications)
- Transition enforcement (advance / conditional / loop)

### What each workflow extension owns (intent)
- Phase definitions and ordering
- Which subagent(s) run in each phase
- Transition logic (always advance? conditional? loop?)
- Task formulation templates
- Command registration (e.g., `/tdd`)

## Core Types

```typescript
/** How a phase executes its tasks */
type PhaseExecution = "sequential" | "parallel";
type PhaseCapability = "filesystem-write" | "shell";

/** What happens after a phase completes */
type TransitionRule =
  | { type: "advance" }
  | { type: "conditional"; decide: (results: PhaseResult, context: WorkflowContext) => string | null }
  | { type: "loop"; until: (results: PhaseResult, context: WorkflowContext, iteration: number) => boolean }

/** A single unit of work within a phase */
interface PhaseTask {
  agent: string;                  // static subagent name
  requires: PhaseCapability[];    // mandatory, statically validated capability contract
  task: string;                   // supports {input}, {context}, {phase:red}, etc.
  skill?: string[];               // optional skills to inject
  label?: string;                 // optional receipt fallback name
}

// In task literals, `requires` immediately follows `agent`. The repository's
// dependency-free semantic validator enforces this canonical shape and checks
// the requirements against the selected agent's declared tools.

interface WorkflowContextBudget {
  compactOutputChars: number;
  aggregateContextChars: number;
  topFindings: number;
}

type PhaseContextMode = "full" | "compact" | "file-only" | "none";

interface PhaseDefinition {
  id: string;              // unique within this workflow
  label: string;           // human-readable, shown in UI
  execution: PhaseExecution;
  tasks: PhaseTask[] | ((context: WorkflowContext) => PhaseTask[]);
  transition: TransitionRule;
  contextMode?: PhaseContextMode; // default: compact
  summarizeOutput?: SummarizeOutputHook;
  contextBudget?: Partial<WorkflowContextBudget>;
}

/** Result from executing a phase */
interface PhaseResult {
  phaseId: string;
  status: "completed" | "failed";
  outputs: TaskOutput[];
  durationMs: number;
  iteration: number;
}

interface TaskReceipt {
  agent: string;
  status: "success" | "error";
  artifactPath?: string;
  verdict?: string;
  topFindings: string[];
}

interface TaskOutput {
  agent: string;
  result: string;          // context-sized according to contextMode
  status: "success" | "error";
  receipt: TaskReceipt;
}

/** Accumulated state across phases — the engine's runtime memory */
interface WorkflowContext {
  /** The original user input that triggered the workflow */
  input: string;
  /** All phase results so far, keyed by phase id */
  phases: Record<string, PhaseResult>;
  /** Current phase id */
  currentPhase: string | null;
  /** Workflow-specific state (extensions can store arbitrary data) */
  state: Record<string, unknown>;
}

/** Full workflow definition — provided by each workflow extension */
interface WorkflowDefinition {
  id: string;              // e.g. "tdd", "triage", "feature-pipeline"
  name: string;            // human-readable
  description: string;
  phases: PhaseDefinition[];
  /** Optional: custom context initialization */
  initialize?: (input: string) => Partial<WorkflowContext>;
  /** Optional: format context for injection into task templates. Result is still bounded. */
  formatContext?: (context: WorkflowContext) => string;
  /** Optional: workflow defaults for output compaction */
  contextMode?: PhaseContextMode;
  contextBudget?: Partial<WorkflowContextBudget>;
  summarizeOutput?: SummarizeOutputHook;
}
```

## Engine Lifecycle

```typescript
class WorkflowEngine {
  private context: WorkflowContext;
  private definition: WorkflowDefinition;
  private pi: ExtensionAPI;

  constructor(pi: ExtensionAPI, definition: WorkflowDefinition) { ... }

  // ── Public API (called by workflow extensions) ──

  /** Start the workflow. Registers event listeners and injects first phase. */
  start(input: string, ctx: ExtensionCommandContext): void

  /** Get current workflow state (for UI, status commands, etc.) */
  getStatus(): {
    engineState: EngineState;
    context: WorkflowContext;
    definition: WorkflowDefinition;
  }

  // ── Event handlers (registered internally) ──

  /** before_agent_start: inject current phase instructions into system prompt */
  private onBeforeAgentStart(event, ctx): BeforeAgentStartEventResult

  /** tool_execution_end: detect subagent completion, capture result */
  private onToolExecutionEnd(event): void

  /** agent_end: when all expected outputs exist, complete and transition */
  private onAgentEnd(ctx): void

  // ── Phase management ──

  /** Build the system prompt addition for the current phase */
  private buildPhaseInstructions(): string

  /** Evaluate advance, conditional, or loop transition rules */
  private evaluateTransition(phase, result, ctx): void

  /** Update UI status bar and notifications */
  private updateUI(ctx: ExtensionContext): void
}
```

### Phase instruction injection

When the engine is active, it adds a block to the system prompt via `before_agent_start`:

```markdown
## Active Workflow: Test-Driven Development

**Current phase: 🔴 Write failing tests** (phase 1 of 3)

Execute this phase by using the `subagent` tool:
- Agent: `builder`
- Required capabilities: `filesystem-write`, `shell`
- Task: "Establish strict red evidence for [user's input]. Prefer a meaningful focused failing test; do not write implementation code. If honest testing would require disproportionate scaffolding, run and justify the closest executable failing check."

After the subagent completes, report the outcome. The workflow engine advances after a successful phase and stops an `advance` workflow when the phase fails.

**Do not skip phases or execute future phases prematurely.**
```

### Phase completion detection

The engine listens for `tool_execution_end` events from `subagent`. It normalizes
`details.mode === "single"` into one child completion and `"parallel"` into one
completion per `details.results` entry. Management results and successful empty
structured result lists (such as async dispatch acknowledgements) do not consume
phase work. Failed empty single/parallel dispatches synthesize error completions
for the remaining phase work so count-based completion cannot hang. Both the event
error flag and nested result error flag are honored. Legacy unstructured results
still count as one dispatch.

Each completion is compacted against the next pending task, retaining the child's
agent, final output, exit/error status, and artifact path in its receipt. Outputs
are capped at the phase's expected task count; a batch-level error does not mark
successful children as failed.

After the agent turn ends (`agent_end`), once all expected task outputs are present,
the engine records the phase result, evaluates the transition rule and either:
- Sends the next phase's instructions via `pi.sendUserMessage()`
- Notifies completion if the workflow is done

## Example: TDD Workflow Extension

The shipped definition is `agent/extensions/workflows/tdd.ts`. All three phases use
`builder`, because red must create and run a failing test/check, green must edit the
implementation, and refactor may edit code before rerunning that same check.

```typescript
const TDD_WORKFLOW: WorkflowDefinition = {
  id: "tdd",
  name: "Test-Driven Development",
  description: "Red-green-refactor cycle for implementing features with tests first",
  phases: [
    {
      id: "red",
      label: "🔴 Write failing tests",
      execution: "sequential",
      tasks: [{
        agent: "builder",
        requires: ["filesystem-write", "shell"],
        task: "Establish strict red evidence for: {input}. Do not write implementation code.",
      }],
      transition: { type: "advance" },
    },
    {
      id: "green",
      label: "🟢 Make tests pass",
      execution: "sequential",
      tasks: [{
        agent: "builder",
        requires: ["filesystem-write", "shell"],
        task: "Write the minimal implementation and rerun the red check.\n\n{phase:red}",
      }],
      transition: { type: "advance" },
    },
    {
      id: "refactor",
      label: "🔵 Constrained refactor",
      execution: "sequential",
      tasks: [{
        agent: "builder",
        requires: ["filesystem-write", "shell"],
        task: "Refactor only where justified, then rerun the red check.\n\n{context}",
      }],
      transition: { type: "advance" },
    },
  ],
};
```

The live task text additionally requires exact commands, exit status, direct
observations or artifacts, verdicts, and residual gaps. It permits a bounded
pre-implementation check only when a useful test would require misleading or
disproportionate scaffolding.

## Example: Triage Workflow Extension

This abbreviated excerpt uses the same agents and capability contracts as
`agent/extensions/workflows/triage.ts`:

```typescript
const TRIAGE_WORKFLOW: WorkflowDefinition = {
  id: "triage",
  name: "Incident Triage",
  description: "Parallel investigation with convergent synthesis",
  phases: [
    {
      id: "investigate",
      label: "🔍 Parallel investigation",
      execution: "parallel",
      tasks: [
        {
          agent: "code-explorer",
          requires: [],
          task: "Investigate source code related to: {input}",
        },
        {
          agent: "log-viewer",
          requires: [],
          task: "Search for observability signals related to: {input}",
        },
      ],
      transition: { type: "advance" },
    },
    {
      id: "synthesize",
      label: "📋 Synthesize findings",
      execution: "sequential",
      tasks: [{
        agent: "architect",
        requires: [],
        task: "Synthesize the findings.\n\n{context}",
      }],
      transition: {
        type: "conditional",
        decide: (result, context) => {
          // The live definition permits at most three investigation rounds.
          return needsMoreEvidence(result, context) ? "investigate" : null;
        },
      },
    },
  ],
};
```

A parallel phase is emitted as one `subagent` call with a task array. The
normalizer expands `details.results` into one ordered completion per child, ignores
management calls, preserves each child's status/output/artifact context, and waits
for the phase's expected task count.

## Composition boundary

Tasks dispatch registered subagents only. The engine does not treat workflow IDs as
agents, embed one workflow in another, or support a `workflow` field on phase
definitions. Cross-workflow composition must remain explicit in extension code
until the runtime implements and tests a dedicated contract.

## UI Contract

The engine provides consistent UI affordances:

```
Status bar:  🔴 TDD: Write failing tests (1/3)
             🔍 Triage: Investigating (2 tracks active)

Notifications:
  ✅ Phase "red" completed (12s)
  ▶️ Advancing to "green"
  ⚠️ Phase "green" failed — builder reported errors
  ❌ Workflow "tdd" failed: Phase "green" failed.
```

Each workflow extension can optionally customize labels and status formatting, but the engine provides sensible defaults.

## Open Questions

1. **State persistence**: Should the engine support saving/restoring workflow state across sessions? Minimal value for TDD (session-scoped), but triage might benefit.

2. **Error recovery**: When a phase fails, should the engine offer retry or skip controls rather than stopping with a failed receipt?
