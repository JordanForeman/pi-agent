import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WorkflowEngine, type WorkflowDefinition } from "../../extension-core/workflow-engine";
import { WorkflowExtensionCore } from "../../extension-core/workflow-extension-core";
import { createSharedReviewPhase, createSharedReviewSynthesisPhase } from "../../extension-core/review-contract";

const PR_REVIEW_WORKFLOW: WorkflowDefinition = {
  id: "pr-review",
  name: "PR Review",
  description: "Triage-driven parallel review with convergent synthesis",
  phases: [
    {
      id: "triage",
      label: "🔍 Triage changes",
      execution: "sequential",
      tasks: [{
        agent: "pr-triage",
        task: [
          "Analyze the current changes and determine which review dimensions apply.",
          "",
          "Context: {input}",
          "",
          "1. Run `git diff --cached` (if empty, fall back to `git diff`)",
          "2. Produce your structured triage report identifying languages, change types,",
          "   architectural indicators, and recommended reviewers",
        ].join("\n"),
      }],
      transition: { type: "advance" },
    },
    createSharedReviewPhase({
      review_context: [
        "User review request: {input}",
        "Triage report:",
        "{phase:triage}",
      ].join("\n"),
    }),
    createSharedReviewSynthesisPhase({
      verdict_instructions: [
        "Produce:",
        "1. **Summary verdict** — overall assessment of the changes",
        "2. **Blockers** — issues that must be resolved before merge (if any)",
        "3. **Non-blocking improvements** — suggestions ranked by impact",
        "4. **Security findings** — any security concerns surfaced during review",
        "5. **Go/no-go recommendation** with clear justification",
      ].join("\n"),
    }),
  ],
};

class PrReviewExtension extends WorkflowExtensionCore {
  constructor(pi: ExtensionAPI) {
    super(pi, {
      id: "pr-review",
      name: "PR Review Workflow",
      summary: "Triage-driven parallel review with convergent synthesis",
    });
  }

  protected registerExtension(): void {
    const engine = new WorkflowEngine(this.pi, PR_REVIEW_WORKFLOW);

    this.pi.registerCommand("review", {
      description: "Start a PR review: triage → parallel specialist review → synthesis",
      handler: async (args, ctx) => {
        if (engine.isActive()) {
          ctx.ui.notify("A review workflow is already running.", "warning");
          return;
        }

        const input = args.trim() || "Review the current changes";
        engine.start(input, ctx);
      },
    });

    this.pi.registerCommand("review:status", {
      description: "Show current review workflow status",
      handler: async (_args, ctx) => {
        const { engineState, context, definition } = engine.getStatus();

        if (engineState === "idle") {
          ctx.ui.notify("No review running. Start one with /review", "info");
          return;
        }

        const phase = context.currentPhase
          ? definition.phases.find((p) => p.id === context.currentPhase)
          : null;

        const lines = [
          `PR Review Workflow: ${engineState}`,
          phase ? `Current: ${phase.label}` : "Current: (none)",
        ];

        ctx.ui.notify(lines.join("\n"), "info");
      },
    });
  }
}

export default function prReview(pi: ExtensionAPI) {
  new PrReviewExtension(pi).register();
}
