import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WorkflowEngine,
  type PhaseContextMode,
  type PhaseExecution,
  type PhaseResult,
  type PhaseTask,
  type TransitionRule,
  type WorkflowContext,
  type WorkflowDefinition,
} from "../../extension-core/workflow-engine";
import { WorkflowExtensionCore } from "../../extension-core/workflow-extension-core";
import { createSharedReviewPhase, createSharedReviewSynthesisPhase } from "../../extension-core/review-contract";

type BuildVerdict = "BUILD_CLEAN" | "BUILD_FIXES_NEEDED" | "BUILD_BLOCKED";

type BuildTaskSpec = {
  agent: string;
  skill?: string[];
  lines: string[];
};

type BuildPhaseSpec = {
  id: string;
  label: string;
  execution: PhaseExecution;
  contextMode?: PhaseContextMode;
  tasks: BuildTaskSpec[];
};

type BuildTemplate = {
  description: string;
  maxFixRounds: number;
  phases: BuildPhaseSpec[];
};

const BUILD_TEMPLATE = loadBuildTemplate();

function loadBuildTemplate(): BuildTemplate {
  const templatePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "build.workflow.json");
  return validateBuildTemplate(JSON.parse(fs.readFileSync(templatePath, "utf8")));
}

function validateBuildTemplate(value: unknown): BuildTemplate {
  const template = asRecord(value, "build workflow template");
  const phases = asArray(template.phases, "phases").map((phase, index) => validatePhaseSpec(phase, index));
  validateRequiredPhaseIds(phases);
  const maxFixRounds = asNumber(template.maxFixRounds, "maxFixRounds");

  if (maxFixRounds < 1) {
    throw new Error("build.workflow.json: maxFixRounds must be at least 1");
  }

  return {
    description: asString(template.description, "description"),
    maxFixRounds,
    phases,
  };
}

function validateRequiredPhaseIds(phases: BuildPhaseSpec[]): void {
  const phaseIds = phases.map((phase) => phase.id);
  const required = ["plan", "implement", "fix", "finalize"];

  if (phaseIds.length !== required.length) {
    throw new Error(`build.workflow.json: expected exactly ${required.length} phases`);
  }

  for (const [index, phaseId] of required.entries()) {
    if (phaseIds[index] !== phaseId) {
      throw new Error(`build.workflow.json: expected phase ${index + 1} to be "${phaseId}"`);
    }
  }

  if (new Set(phaseIds).size !== phaseIds.length) {
    throw new Error("build.workflow.json: phase ids must be unique");
  }
}

function validatePhaseSpec(value: unknown, index: number): BuildPhaseSpec {
  const phase = asRecord(value, `phases[${index}]`);
  const execution = asString(phase.execution, `phases[${index}].execution`);
  const contextMode = phase.contextMode === undefined ? undefined : asString(phase.contextMode, `phases[${index}].contextMode`);
  const tasks = asArray(phase.tasks, `phases[${index}].tasks`).map((task, taskIndex) => validateTaskSpec(task, index, taskIndex));

  if (tasks.length === 0) {
    throw new Error(`build.workflow.json: phases[${index}].tasks must not be empty`);
  }

  if (execution !== "sequential" && execution !== "parallel") {
    throw new Error(`build.workflow.json: phases[${index}].execution must be sequential or parallel`);
  }

  if (contextMode !== undefined && !["full", "compact", "file-only", "none"].includes(contextMode)) {
    throw new Error(`build.workflow.json: phases[${index}].contextMode is invalid`);
  }

  return {
    id: asString(phase.id, `phases[${index}].id`),
    label: asString(phase.label, `phases[${index}].label`),
    execution,
    contextMode: contextMode as PhaseContextMode | undefined,
    tasks,
  };
}

function validateTaskSpec(value: unknown, phaseIndex: number, taskIndex: number): BuildTaskSpec {
  const task = asRecord(value, `phases[${phaseIndex}].tasks[${taskIndex}]`);
  const skill = task.skill === undefined
    ? undefined
    : asArray(task.skill, `phases[${phaseIndex}].tasks[${taskIndex}].skill`).map((item, index) => asString(item, `skill[${index}]`));

  const lines = asArray(task.lines, `phases[${phaseIndex}].tasks[${taskIndex}].lines`).map((line, index) => {
    if (typeof line !== "string") {
      throw new Error(`build.workflow.json: lines[${index}] must be a string`);
    }
    return line;
  });

  if (!lines.some((line) => line.trim() !== "")) {
    throw new Error(`build.workflow.json: phases[${phaseIndex}].tasks[${taskIndex}].lines must include prompt text`);
  }

  return {
    agent: asString(task.agent, `phases[${phaseIndex}].tasks[${taskIndex}].agent`),
    skill,
    lines,
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`build.workflow.json: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`build.workflow.json: ${label} must be an array`);
  }
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`build.workflow.json: ${label} must be a non-empty string`);
  }
  return value;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`build.workflow.json: ${label} must be an integer`);
  }
  return value;
}

function extractBuildVerdict(result: PhaseResult): BuildVerdict | null {
  const text = result.outputs
    .flatMap((output) => [output.receipt.verdict, output.result])
    .filter((value): value is string => Boolean(value))
    .join("\n");

  const match = text.match(/(?:^|\n)\s*(?:\*\*)?Verdict(?:\*\*)?\s*:\s*(?:\*\*)?(BUILD_(?:CLEAN|FIXES_NEEDED|BLOCKED))\b/i);
  return match ? match[1].toUpperCase() as BuildVerdict : null;
}

function fixRounds(context: WorkflowContext): number {
  return typeof context.state.fixRounds === "number" ? context.state.fixRounds : 0;
}

function templateTasks(tasks: BuildTaskSpec[]): PhaseTask[] {
  return tasks.map((task) => ({
    agent: task.agent,
    task: task.lines.join("\n"),
    ...(task.skill ? { skill: task.skill } : {}),
  }));
}

function transitionFor(phaseId: string): TransitionRule {
  if (phaseId === "synthesize") {
    return {
      type: "conditional",
      decide: (result, context) => {
        const verdict = extractBuildVerdict(result);
        context.state.finalVerdict = verdict ?? "BUILD_BLOCKED";

        if (verdict === "BUILD_FIXES_NEEDED" && fixRounds(context) < BUILD_TEMPLATE.maxFixRounds) {
          context.state.fixRounds = fixRounds(context) + 1;
          return "fix";
        }

        return "finalize";
      },
    };
  }

  if (phaseId === "fix") {
    return {
      type: "conditional",
      decide: (result, context) => {
        if (result.status === "failed") {
          context.state.finalVerdict = "BUILD_BLOCKED";
          return "finalize";
        }
        return "review";
      },
    };
  }

  return { type: "advance" };
}

function formatBuildContext(context: WorkflowContext): string {
  const phaseSummaries = Object.entries(context.phases)
    .map(([phaseId, result]) => {
      const outputs = result.outputs.map((output) => `### ${phaseId} — ${output.agent}\n${output.result}`);
      return outputs.join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n");

  return [
    "Build state:",
    `- Final verdict: ${typeof context.state.finalVerdict === "string" ? context.state.finalVerdict : "pending"}`,
    `- Fix rounds: ${fixRounds(context)}/${BUILD_TEMPLATE.maxFixRounds}`,
    "",
    phaseSummaries || "(no phase findings yet)",
  ].join("\n");
}

function createBuildWorkflow(commandName: string): WorkflowDefinition {
  const buildPhases = Object.fromEntries(
    BUILD_TEMPLATE.phases.map((phase) => [phase.id, {
      id: phase.id,
      label: phase.label,
      execution: phase.execution,
      contextMode: phase.contextMode,
      tasks: templateTasks(phase.tasks),
      transition: transitionFor(phase.id),
    }]),
  ) as Record<string, WorkflowDefinition["phases"][number]>;

  return {
    id: commandName,
    name: "Build",
    description: BUILD_TEMPLATE.description,
    formatContext: formatBuildContext,
    initialize: (input) => ({
      input,
      state: {
        fixRounds: 0,
        finalVerdict: null,
      },
    }),
    phases: [
      buildPhases.plan,
      buildPhases.implement,
      createSharedReviewPhase({
        review_context: [
          "Original objective: {input}",
          "Plan/implementation context:",
          "{context}",
        ].join("\n"),
      }),
      createSharedReviewSynthesisPhase({
        verdict_instructions: [
          "Return exactly one verdict line:",
          "- Verdict: BUILD_CLEAN — no blockers or fixes worth doing now remain",
          "- Verdict: BUILD_FIXES_NEEDED — concrete in-scope fixes should be applied before completion",
          "- Verdict: BUILD_BLOCKED — user/product/scope/security/architecture decision is required before fixes",
          "",
          "Then provide:",
          "1. Accepted fixes worth doing now (file-specific)",
          "2. Optional/deferred feedback",
          "3. Validation still required",
          "4. Decision needed, if blocked",
        ].join("\n"),
      }, transitionFor("synthesize")),
      buildPhases.fix,
      buildPhases.finalize,
    ],
  };
}

class BuildExtension extends WorkflowExtensionCore {
  private readonly buildEngine = new WorkflowEngine(this.pi, createBuildWorkflow("build"));

  constructor(pi: ExtensionAPI) {
    super(pi, {
      id: "build",
      name: "Build Workflow",
      summary: "Build with in-flight review and bounded fix passes",
    });
  }

  protected registerExtension(): void {
    this.registerLoopCommand("build", this.buildEngine);
    this.registerStatusCommand("build:status", this.buildEngine, "build");
  }

  private registerLoopCommand(name: "build", engine: WorkflowEngine): void {
    this.pi.registerCommand(name, {
      description: `Start a ${name}: plan → implement → parallel review → fix/re-review until clean or capped`,
      handler: async (args, ctx) => {
        const input = args.trim();
        if (!input) {
          ctx.ui.notify(`Usage: /${name} <what to build or fix>`, "error");
          return;
        }

        if (engine.isActive()) {
          ctx.ui.notify(`A ${name} workflow is already running. Wait for it to complete.`, "warning");
          return;
        }

        engine.start(input, ctx);
      },
    });
  }

  private registerStatusCommand(name: string, engine: WorkflowEngine, label: string): void {
    this.pi.registerCommand(name, {
      description: `Show current ${label} workflow status`,
      handler: async (_args, ctx) => {
        const { engineState, context, definition } = engine.getStatus();

        if (engineState === "idle") {
          ctx.ui.notify(`No ${label} workflow running. Start one with /${label} <objective>`, "info");
          return;
        }

        const phase = context.currentPhase
          ? definition.phases.find((p) => p.id === context.currentPhase)
          : null;
        const rounds = fixRounds(context);
        const verdict = typeof context.state.finalVerdict === "string" ? context.state.finalVerdict : "pending";

        ctx.ui.notify([
          `${definition.name}: ${engineState}`,
          `Objective: ${context.input}`,
          phase ? `Current: ${phase.label}` : "Current: (none)",
          `Fix rounds: ${rounds}/${BUILD_TEMPLATE.maxFixRounds}`,
          `Verdict: ${verdict}`,
        ].join("\n"), "info");
      },
    });
  }
}

export default function build(pi: ExtensionAPI) {
  new BuildExtension(pi).register();
}
