import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WorkflowEngine, type WorkflowDefinition } from "../../extension-core/workflow-engine";
import { WorkflowExtensionCore } from "../../extension-core/workflow-extension-core";

const RESEARCH_WORKFLOW: WorkflowDefinition = {
  id: "research",
  name: "Research",
  description: "Bounded autonomous research with cited evidence",
  phases: [{
    id: "research",
    label: "🔎 Research the objective",
    execution: "sequential",
    tasks: [{
      agent: "code-explorer",
      requires: ["shell"],
      skill: ["read-only", "code-references", "research-mode", "evidence-report"],
      task: [
        "Research this objective thoroughly: {input}",
        "Keep target repositories and shared state read-only.",
        "Use scratch_workspace for disposable clones or generated research artifacts, work only inside the returned root, and remove that exact root when finished.",
        "Return the answer with direct citations, commands or observations, contradictions, and explicit knowledge gaps.",
      ].join("\n"),
    }],
    transition: { type: "advance" },
  }],
};

class ResearchExtension extends WorkflowExtensionCore {
  constructor(pi: ExtensionAPI) {
    super(pi, { id: "research", name: "Research Workflow", summary: "Bounded evidence-backed research" });
  }

  protected registerExtension(): void {
    const engine = new WorkflowEngine(this.pi, RESEARCH_WORKFLOW);
    this.pi.registerCommand("research", {
      description: "Research a question with bounded autonomous evidence gathering",
      handler: async (args, ctx) => {
        const input = args.trim();
        if (!input) return void ctx.ui.notify("Usage: /research <question or objective>", "error");
        if (engine.isActive()) return void ctx.ui.notify("A research workflow is already running.", "warning");
        engine.start(input, ctx);
      },
    });
    this.pi.registerCommand("research:status", {
      description: "Show current research workflow status",
      handler: async (_args, ctx) => {
        const { engineState, context } = engine.getStatus();
        ctx.ui.notify(`Research Workflow: ${engineState}\nObjective: ${context.input || "(none)"}`, "info");
      },
    });
  }
}

export default function research(pi: ExtensionAPI): void {
  new ResearchExtension(pi).register();
}
