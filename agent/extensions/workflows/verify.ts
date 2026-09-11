import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WorkflowEngine, type WorkflowDefinition } from "../../extension-core/workflow-engine";
import { WorkflowExtensionCore } from "../../extension-core/workflow-extension-core";

const VERIFY_WORKFLOW: WorkflowDefinition = {
  id: "verify",
  name: "Verification",
  description: "Project-contract and real-surface verification",
  phases: [{
    id: "verify",
    label: "✅ Verify the affected surface",
    execution: "sequential",
    tasks: [{
      agent: "code-explorer",
      requires: ["shell"],
      skill: ["read-only", "code-references", "validation-discovery", "verify-mode", "evidence-report"],
      task: [
        "Verify this objective: {input}",
        "Keep target source read-only. Discover project checks, then exercise the affected real surface when practical.",
        "Use scratch_workspace for disposable clones or fixtures, start and stop only local services you launch, and remove the exact owned scratch root when finished.",
        "Report VERIFIED, NOT VERIFIED, or INCONCLUSIVE with exact commands, statuses, direct observations or artifacts, and residual gaps.",
      ].join("\n"),
    }],
    transition: { type: "advance" },
  }],
};

class VerifyExtension extends WorkflowExtensionCore {
  constructor(pi: ExtensionAPI) {
    super(pi, { id: "verify", name: "Verify Workflow", summary: "Real-surface verification" });
  }

  protected registerExtension(): void {
    const engine = new WorkflowEngine(this.pi, VERIFY_WORKFLOW);
    this.pi.registerCommand("verify", {
      description: "Verify a change against project checks and its real affected surface",
      handler: async (args, ctx) => {
        const input = args.trim();
        if (!input) return void ctx.ui.notify("Usage: /verify <change or claim>", "error");
        if (engine.isActive()) return void ctx.ui.notify("A verification workflow is already running.", "warning");
        engine.start(input, ctx);
      },
    });
    this.pi.registerCommand("verify:status", {
      description: "Show current verification workflow status",
      handler: async (_args, ctx) => {
        const { engineState, context } = engine.getStatus();
        ctx.ui.notify(`Verify Workflow: ${engineState}\nObjective: ${context.input || "(none)"}`, "info");
      },
    });
  }
}

export default function verify(pi: ExtensionAPI): void {
  new VerifyExtension(pi).register();
}
