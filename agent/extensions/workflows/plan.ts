import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WorkflowEngine, type WorkflowDefinition } from "../../extension-core/workflow-engine";
import { WorkflowExtensionCore } from "../../extension-core/workflow-extension-core";

const PLAN_WORKFLOW: WorkflowDefinition = {
  id: "plan",
  name: "Plan",
  description: "Focused implementation planning with Codex Astra",
  phases: [{
    id: "plan",
    label: "🧭 Plan scope and validation",
    execution: "sequential",
    tasks: [{
      agent: "planner",
      requires: [],
      skill: ["search-before-write", "validation-discovery", "read-only"],
      model: "openai-codex/gpt-6-astra",
      task: [
        "Create a concise implementation plan for: {input}",
        "Inspect the live repository before deciding what should change. Do not edit files.",
        "Include scoped objective and non-goals, likely edit surfaces, incremental milestones, acceptance criteria, project-specific validation, risks, and decisions that require user approval.",
      ].join("\n"),
    }],
    transition: { type: "advance" },
  }],
};

class PlanExtension extends WorkflowExtensionCore {
  constructor(pi: ExtensionAPI) {
    super(pi, { id: "plan", name: "Plan Workflow", summary: "Focused implementation planning with Codex Astra" });
  }

  protected registerExtension(): void {
    const engine = new WorkflowEngine(this.pi, PLAN_WORKFLOW);
    this.pi.registerCommand("plan", {
      description: "Plan an implementation with Codex Astra",
      handler: async (args, ctx) => {
        const input = args.trim();
        if (!input) return void ctx.ui.notify("Usage: /plan <objective>", "error");
        if (engine.isActive()) return void ctx.ui.notify("A plan workflow is already running.", "warning");
        engine.start(input, ctx);
      },
    });
  }
}

export default function plan(pi: ExtensionAPI): void {
  new PlanExtension(pi).register();
}
