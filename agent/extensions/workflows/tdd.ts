import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WorkflowEngine, type WorkflowDefinition } from "../../extension-core/workflow-engine";
import { WorkflowExtensionCore } from "../../extension-core/workflow-extension-core";

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
        task: [
          "Establish strict red evidence for the intended behavior: {input}",
          "",
          "Rules:",
          "- Test-first is the default: prefer a meaningful focused test that fails for the missing behavior",
          "- Do not write any implementation code",
          "- On the default test path, each test should specify one clear behavior and use the project's existing test framework and conventions",
          "- Bounded exception: if a useful test would require misleading or disproportionate scaffolding, run the closest executable pre-implementation check instead and justify why that check is the honest substitute",
          "- The selected test or check must fail clearly before implementation",
          "- Record its exact command, non-zero status, expected failure observation, artifact pointer, and residual gap",
        ].join("\n"),
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
        task: [
          "Write the MINIMAL implementation to make the red test or check pass.",
          "",
          "Rules:",
          "- Do the simplest thing that could possibly work",
          "- Do not add features, optimizations, or abstractions beyond what the red evidence requires",
          "- Re-run the exact same focused test or executable check selected in red",
          "- Report command, exit status, direct observation or artifact, verdict, and residual gaps",
          "",
          "Red evidence from the red phase:",
          "{phase:red}",
        ].join("\n"),
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
        task: [
          "Refactor the implementation only where existing behavior justifies a design cleanup.",
          "",
          "Rules:",
          "- Improve naming, structure, and readability",
          "- Extract duplication if warranted",
          "- Do not modify the red test/check specification or add behavior",
          "- If no useful cleanup is warranted, leave code unchanged",
          "- Re-run the exact same focused test or executable check selected in red",
          "- Report command, exit status, direct observation or artifact, verdict, and residual gaps",
          "",
          "Full TDD cycle context:",
          "{context}",
        ].join("\n"),
      }],
      transition: { type: "advance" },
    },
  ],
};

class TddExtension extends WorkflowExtensionCore {
  constructor(pi: ExtensionAPI) {
    super(pi, {
      id: "tdd",
      name: "TDD Workflow",
      summary: "Red-green-refactor cycle",
    });
  }

  protected registerExtension(): void {
    const engine = new WorkflowEngine(this.pi, TDD_WORKFLOW);

    this.pi.registerCommand("tdd", {
      description: "Start a TDD workflow: write failing tests → implement → refactor",
      handler: async (args, ctx) => {
        const input = args.trim();
        if (!input) {
          ctx.ui.notify("Usage: /tdd <what to implement>", "error");
          return;
        }

        if (engine.isActive()) {
          ctx.ui.notify("A TDD workflow is already running. Wait for it to complete.", "warning");
          return;
        }

        engine.start(input, ctx);
      },
    });

    this.pi.registerCommand("tdd:status", {
      description: "Show current TDD workflow status",
      handler: async (_args, ctx) => {
        const { engineState, context, definition } = engine.getStatus();

        if (engineState === "idle") {
          ctx.ui.notify("No TDD workflow running. Start one with /tdd <objective>", "info");
          return;
        }

        const phase = context.currentPhase
          ? definition.phases.find((p) => p.id === context.currentPhase)
          : null;

        const completedPhases = Object.keys(context.phases).length;
        const lines = [
          `TDD Workflow: ${engineState}`,
          `Objective: ${context.input}`,
          `Progress: ${completedPhases}/${definition.phases.length} phases`,
          phase ? `Current: ${phase.label}` : "Current: (none)",
        ];

        ctx.ui.notify(lines.join("\n"), "info");
      },
    });
  }
}

export default function tdd(pi: ExtensionAPI) {
  new TddExtension(pi).register();
}
