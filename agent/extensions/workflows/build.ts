import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WorkflowEngine,
  type PhaseCapability,
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
  requires: PhaseCapability[];
  skill?: string[];
  model?: string;
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
  reviewModels: { core?: string; selector?: string };
  selection: BuildPhaseSpec;
  phases: BuildPhaseSpec[];
};

const SPECIALIST_ROLES = ["design-reviewer", "rails-reviewer", "frontend-reviewer", "testing-reviewer"] as const;
type SelectionDecision = { agent: string; applicable: boolean; reason: string };

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

  if (maxFixRounds < 1 || maxFixRounds > 3) {
    throw new Error("build.workflow.json: maxFixRounds must be between 1 and 3");
  }

  const models = template.reviewModels === undefined ? {} : asRecord(template.reviewModels, "reviewModels");
  for (const key of Object.keys(models)) {
    if (key !== "core" && key !== "selector") throw new Error(`build.workflow.json: unknown reviewModels key "${key}"`);
    asString(models[key], `reviewModels.${key}`);
  }
  const selection = validatePhaseSpec(template.selection, "selection");
  if (selection.id !== "select-reviewers" || selection.execution !== "sequential"
    || selection.tasks.length !== 1 || selection.tasks[0].agent !== "pr-triage") {
    throw new Error("build.workflow.json: selection must dispatch only pr-triage sequentially as select-reviewers");
  }

  return {
    description: asString(template.description, "description"),
    maxFixRounds,
    reviewModels: models as BuildTemplate["reviewModels"],
    selection,
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

function validatePhaseSpec(value: unknown, index: number | string): BuildPhaseSpec {
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

function validateTaskSpec(value: unknown, phaseIndex: number | string, taskIndex: number): BuildTaskSpec {
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
    requires: asCapabilities(task.requires, `phases[${phaseIndex}].tasks[${taskIndex}].requires`),
    skill,
    ...(task.model !== undefined ? { model: asString(task.model, `phases[${phaseIndex}].tasks[${taskIndex}].model`) } : {}),
    lines,
  };
}

function asCapabilities(value: unknown, label: string): PhaseCapability[] {
  return asArray(value, label).map((item, index) => {
    const capability = asString(item, `${label}[${index}]`);
    if (capability !== "filesystem-write" && capability !== "shell") {
      throw new Error(`build.workflow.json: ${label}[${index}] is invalid`);
    }
    return capability;
  });
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

function successfulPhase(result: PhaseResult | undefined, agents: readonly string[], iteration?: number): boolean {
  return Boolean(result && result.status === "completed"
    && (iteration === undefined || result.iteration === iteration)
    && result.outputs.length === agents.length
    && agents.every((agent) => result.outputs.filter((output) => output.agent === agent
      && output.status === "success" && output.result.trim() !== "").length === 1));
}

function extractBuildVerdict(result: PhaseResult): BuildVerdict | null {
  if (!successfulPhase(result, ["reviewer"])) return null;
  // Parse raw synthesis, never the lossy first-verdict receipt. Exactly one standalone line.
  const text = result.outputs[0].result;
  const lines = text.split(/\r?\n/).filter((line) => /^\s*(?:\*\*)?Verdict\b/i.test(line));
  if (lines.length !== 1) return null;
  const match = lines[0].match(/^\s*(?:\*\*)?Verdict(?:\*\*)?\s*:\s*(?:\*\*)?(BUILD_(?:CLEAN|FIXES_NEEDED|BLOCKED))(?:\*\*)?\s*$/);
  // A second verdict token, even in prose, is ambiguous and must not authorize fixes.
  const tokens = text.match(/\bBUILD_[A-Z_]+\b/g) ?? [];
  return match && tokens.length === 1 ? match[1] as BuildVerdict : null;
}

function parseSelection(result: PhaseResult | undefined, iteration: number): SelectionDecision[] | null {
  if (!successfulPhase(result, ["pr-triage"], iteration)) return null;
  try {
    const raw = result!.outputs[0].result;
    const value = JSON.parse(raw);
    // JSON.parse silently overwrites duplicate keys. This fixed schema has exactly
    // 13 keys; tokenize whole strings (including escaped quotes in reasons) before
    // counting property colons, then validate every object's shape below.
    const keyCount = [...raw.matchAll(/"(?:\\.|[^"\\])*"\s*(:)?/g)].filter((match) => match[1]).length;
    if (keyCount !== 1 + 3 * SPECIALIST_ROLES.length) return null;
    if (!value || Array.isArray(value) || Object.keys(value).join() !== "decisions"
      || !Array.isArray(value.decisions) || value.decisions.length !== SPECIALIST_ROLES.length) return null;
    const seen = new Set<string>();
    for (const decision of value.decisions) {
      if (!decision || Array.isArray(decision) || Object.keys(decision).sort().join() !== "agent,applicable,reason"
        || !SPECIALIST_ROLES.includes(decision.agent) || seen.has(decision.agent)
        || typeof decision.applicable !== "boolean" || typeof decision.reason !== "string" || !decision.reason.trim()) return null;
      seen.add(decision.agent);
    }
    return value.decisions;
  } catch {
    return null;
  }
}

function reviewPrerequisites(context: WorkflowContext, includeSelection = true, includeSpecialists = true): boolean {
  const round = fixRounds(context) + 1;
  if (!successfulPhase(context.phases.plan, ["planner"])
    || !successfulPhase(context.phases.implement, ["builder"])
    || !successfulPhase(context.phases["core-review"], ["reviewer"], round)) return false;
  if (!includeSelection) return true;
  const decisions = parseSelection(context.phases["select-reviewers"], round);
  if (!decisions) return false;
  const agents = decisions.filter((decision) => decision.applicable).map((decision) => decision.agent);
  // Specialist phase iterations count dispatches, not rounds (zero selection skips it).
  return !includeSpecialists || agents.length === 0 || successfulPhase(context.phases["specialist-review"], agents);
}

function blockBuild(context: WorkflowContext, reason: string): string {
  context.state.finalVerdict = "BUILD_BLOCKED";
  context.state.blockedReason = reason;
  return "finalize";
}

function fixRounds(context: WorkflowContext): number {
  return typeof context.state.fixRounds === "number" ? context.state.fixRounds : 0;
}

function templateTasks(tasks: BuildTaskSpec[]): PhaseTask[] {
  return tasks.map((task) => ({
    agent: task.agent,
    requires: task.requires,
    task: task.lines.join("\n"),
    ...(task.skill ? { skill: task.skill } : {}),
    ...(task.model !== undefined ? { model: task.model } : {}),
  }));
}

function transitionFor(phaseId: string): TransitionRule {
  if (phaseId === "finalize") return { type: "advance" };
  return {
    type: "conditional",
    decide: (result, context) => {
      if (phaseId === "synthesize") {
        const verdict = reviewPrerequisites(context) && result.iteration === fixRounds(context) + 1
          ? extractBuildVerdict(result) : null;
        if (!verdict) return blockBuild(context, "Review prerequisites or synthesis failed, were missing, or were ambiguous.");
        context.state.finalVerdict = verdict;
        if (verdict === "BUILD_FIXES_NEEDED" && fixRounds(context) < BUILD_TEMPLATE.maxFixRounds) {
          context.state.fixRounds = fixRounds(context) + 1;
          return "fix";
        }
        return "finalize";
      }
      if (phaseId === "select-reviewers") {
        const decisions = parseSelection(result, fixRounds(context) + 1);
        if (!reviewPrerequisites(context, false) || !decisions) {
          return blockBuild(context, "Specialist selection failed or violated the complete four-role JSON contract.");
        }
        context.state.selection = decisions;
        return decisions.some((decision) => decision.applicable) ? "specialist-review" : "synthesize";
      }
      if (phaseId === "specialist-review") {
        return reviewPrerequisites(context) ? "synthesize" : blockBuild(context, "Current specialist review evidence is incomplete or failed.");
      }
      const agent = phaseId === "plan" ? "planner" : phaseId === "core-review" ? "reviewer" : "builder";
      if (!successfulPhase(result, [agent])) return blockBuild(context, `${phaseId} failed or returned no usable evidence.`);
      if (phaseId === "fix") {
        const evidence = context.state.fixEvidence as PhaseResult[];
        evidence.push(result);
        // Active review evidence belongs to exactly one round. Do not reinject old findings/verdicts.
        for (const id of ["core-review", "select-reviewers", "specialist-review", "synthesize", "fix"]) delete context.phases[id];
        delete context.state.selection;
        delete context.state.blockedReason;
        context.state.finalVerdict = null;
        return "core-review";
      }
      if (phaseId === "core-review") {
        return reviewPrerequisites(context, false) ? "select-reviewers" : blockBuild(context, "Core review prerequisites are missing or failed.");
      }
      return phaseId === "plan" ? "implement" : "core-review";
    },
  };
}

function formatBuildContext(context: WorkflowContext): string {
  const format = (phaseId: string, result: PhaseResult) => result.outputs
    .map((output) => `### ${phaseId} — ${output.agent} (${output.status})\n${output.result}`)
    .join("\n\n");
  // Current evidence first; fix history is separate implementation evidence, not active findings.
  const activeIds = ["synthesize", "core-review", "select-reviewers", "specialist-review"];
  const active = activeIds.filter((id) => context.phases[id]).map((id) => format(id, context.phases[id]));
  const fixEvidence = (context.state.fixEvidence as PhaseResult[]).map((result) => format(`fix evidence ${result.iteration}`, result));
  const background = Object.entries(context.phases).filter(([id]) => !activeIds.includes(id)).map(([id, result]) => format(id, result));
  return [
    "Build state:",
    `- Final verdict: ${typeof context.state.finalVerdict === "string" ? context.state.finalVerdict : "pending"}`,
    `- Fix rounds: ${fixRounds(context)}/${BUILD_TEMPLATE.maxFixRounds}`,
    ...(context.state.blockedReason ? [`- Blocked reason: ${context.state.blockedReason}`] : []),
    "",
    ...active,
    ...fixEvidence,
    ...background,
  ].join("\n\n");
}

export function createBuildWorkflow(commandName: string): WorkflowDefinition {
  const buildPhases = Object.fromEntries(
    BUILD_TEMPLATE.phases.map((phase) => [phase.id, {
      id: phase.id,
      label: phase.label,
      execution: phase.execution,
      // Retain raw evidence so an empty successful child cannot pass a receipt-only check.
      contextMode: "full",
      tasks: templateTasks(phase.tasks),
      transition: transitionFor(phase.id),
    }]),
  ) as Record<string, WorkflowDefinition["phases"][number]>;

  const reviewContext = { review_context: "Original objective: {input}\nCurrent build context:\n{context}" };
  const core = createSharedReviewPhase(reviewContext, ["reviewer"]);
  const coreTasks = core.tasks as PhaseTask[];
  if (BUILD_TEMPLATE.reviewModels.core !== undefined) coreTasks[0].model = BUILD_TEMPLATE.reviewModels.core;
  const selectorTasks = templateTasks(BUILD_TEMPLATE.selection.tasks);
  if (BUILD_TEMPLATE.reviewModels.selector !== undefined) selectorTasks[0].model = BUILD_TEMPLATE.reviewModels.selector;

  return {
    id: commandName,
    name: "Build",
    description: BUILD_TEMPLATE.description,
    formatContext: formatBuildContext,
    // Build gates require lossless evidence in synthesis AND fix dispatches.
    // Disable aggregate truncation, rather than substituting a larger finite cap.
    // Other workflows retain their bounded default; provider limits still apply.
    contextBudget: { aggregateContextChars: Number.POSITIVE_INFINITY },
    initialize: (input) => ({
      input,
      state: {
        fixRounds: 0,
        finalVerdict: null,
        fixEvidence: [],
      },
    }),
    phases: [
      buildPhases.plan,
      buildPhases.implement,
      { ...core, id: "core-review", label: "🔎 Core correctness and safety review", execution: "sequential", contextMode: "full", transition: transitionFor("core-review") },
      {
        ...BUILD_TEMPLATE.selection,
        contextMode: "full",
        tasks: selectorTasks,
        transition: transitionFor("select-reviewers"),
      },
      {
        id: "specialist-review",
        label: "🔬 Relevant specialist reviews",
        execution: "parallel",
        contextMode: "full",
        tasks: (context) => createSharedReviewPhase(reviewContext,
          (context.state.selection as SelectionDecision[]).filter((decision) => decision.applicable).map((decision) => decision.agent),
        ).tasks as PhaseTask[],
        transition: transitionFor("specialist-review"),
      },
      createSharedReviewSynthesisPhase({
        verdict_instructions: [
          "Return exactly one standalone verdict line (no suffix, no other BUILD_* tokens):",
          "Verdict: BUILD_CLEAN",
          "or Verdict: BUILD_FIXES_NEEDED",
          "or Verdict: BUILD_BLOCKED",
          "Choose clean only when no blockers or worthwhile fixes remain; fixes-needed only for concrete approved in-scope fixes; blocked for missing evidence or user/product/scope/security/architecture decisions.",
          "Use only current-round core/selection/specialist findings. Fix evidence records prior implementation, not unresolved reviewer findings.",
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
      description: `Start a ${name}: plan → implement → core review → select specialists → synthesis → bounded fixes`,
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
