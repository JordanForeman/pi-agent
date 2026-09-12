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
type BuildMode = "build" | "vibe";
type VibePreparation = { status: "READY"; repository: string; branch: string; base: string };

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
const VIBE_MAX_FIX_ROUNDS = 10;
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

function parseVibePreparation(result: PhaseResult): VibePreparation | null {
  if (!successfulPhase(result, ["git-ops"])) return null;
  try {
    const raw = result.outputs[0].result;
    const propertyCount = [...raw.matchAll(/"(?:\\.|[^"\\])*"\s*:/g)].length;
    const value = JSON.parse(raw);
    if (propertyCount !== 4 || !value || Array.isArray(value) || Object.keys(value).sort().join() !== "base,branch,repository,status"
      || value.status !== "READY" || typeof value.repository !== "string"
      || typeof value.branch !== "string" || typeof value.base !== "string") return null;
    const repository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
    const ref = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
    if (!repository.test(value.repository) || !ref.test(value.branch) || !ref.test(value.base)
      || value.branch === value.base || value.branch.includes("..") || value.branch.includes("//")) return null;
    return value as VibePreparation;
  } catch {
    return null;
  }
}

function extractPullRequestUrl(result: PhaseResult, context: WorkflowContext): string | null {
  if (!successfulPhase(result, ["git-ops"])) return null;
  try {
    const raw = result.outputs[0].result;
    const propertyCount = [...raw.matchAll(/"(?:\\.|[^"\\])*"\s*:/g)].length;
    const value = JSON.parse(raw);
    if (propertyCount !== 8 || !value || Array.isArray(value)
      || Object.keys(value).sort().join() !== "branch,commit,prState,prUrl,remoteCommit,repository,scope,status"
      || value.status !== "PUBLISHED" || value.prState !== "OPEN" || value.scope !== "OBJECTIVE_ONLY"
      || typeof value.repository !== "string" || typeof value.branch !== "string"
      || typeof value.commit !== "string" || typeof value.remoteCommit !== "string" || typeof value.prUrl !== "string"
      || value.repository !== context.state.repository || value.branch !== context.state.branch
      || !/^[0-9a-f]{40}$/i.test(value.commit) || value.remoteCommit !== value.commit) return null;
    const match = value.prUrl.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+$/i);
    return match?.[1] === value.repository ? value.prUrl : null;
  } catch {
    return null;
  }
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

function maxFixRounds(mode: BuildMode): number {
  return mode === "vibe" ? VIBE_MAX_FIX_ROUNDS : BUILD_TEMPLATE.maxFixRounds;
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

function transitionFor(phaseId: string, mode: BuildMode): TransitionRule {
  if (phaseId === "finalize") return { type: "advance" };
  return {
    type: "conditional",
    decide: (result, context) => {
      if (phaseId === "synthesize") {
        const verdict = reviewPrerequisites(context) && result.iteration === fixRounds(context) + 1
          ? extractBuildVerdict(result) : null;
        if (!verdict) return blockBuild(context, "Review prerequisites or synthesis failed, were missing, or were ambiguous.");
        context.state.finalVerdict = verdict;
        if (verdict === "BUILD_FIXES_NEEDED" && fixRounds(context) < maxFixRounds(mode)) {
          context.state.fixRounds = fixRounds(context) + 1;
          return "fix";
        }
        if (verdict === "BUILD_CLEAN" && mode === "vibe") return "publish";
        return "finalize";
      }
      if (phaseId === "publish") {
        const prUrl = extractPullRequestUrl(result, context);
        if (!prUrl) return blockBuild(context, "Publication failed or returned incomplete, contradictory, or unscoped proof.");
        context.state.prUrl = prUrl;
        return "finalize";
      }
      if (phaseId === "prepare") {
        const preparation = parseVibePreparation(result);
        if (!preparation) return blockBuild(context, "Repository preparation failed or did not prove a safe topic branch.");
        Object.assign(context.state, preparation);
        return "plan";
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

function formatBuildContext(context: WorkflowContext, mode: BuildMode): string {
  const format = (phaseId: string, result: PhaseResult) => result.outputs
    .map((output) => `### ${phaseId} — ${output.agent} (${output.status})\n${output.result}`)
    .join("\n\n");
  // Current evidence first; fix history is separate implementation evidence, not active findings.
  const activeIds = ["publish", "synthesize", "core-review", "select-reviewers", "specialist-review"];
  const active = activeIds.filter((id) => context.phases[id]).map((id) => format(id, context.phases[id]));
  const fixEvidence = (context.state.fixEvidence as PhaseResult[]).map((result) => format(`fix evidence ${result.iteration}`, result));
  const background = Object.entries(context.phases).filter(([id]) => !activeIds.includes(id)).map(([id, result]) => format(id, result));
  return [
    "Build state:",
    `- Final verdict: ${typeof context.state.finalVerdict === "string" ? context.state.finalVerdict : "pending"}`,
    `- Fix rounds: ${fixRounds(context)}/${maxFixRounds(mode)}`,
    ...(context.state.prUrl ? [`- Pull request: ${context.state.prUrl}`] : []),
    ...(context.state.blockedReason ? [`- Blocked reason: ${context.state.blockedReason}`] : []),
    "",
    ...active,
    ...fixEvidence,
    ...background,
  ].join("\n\n");
}

export function createBuildWorkflow(commandName: string): WorkflowDefinition {
  const mode: BuildMode = commandName === "vibe" ? "vibe" : "build";
  const buildPhases = Object.fromEntries(
    BUILD_TEMPLATE.phases.map((phase) => [phase.id, {
      id: phase.id,
      label: phase.label,
      execution: phase.execution,
      // Retain raw evidence so an empty successful child cannot pass a receipt-only check.
      contextMode: "full",
      tasks: templateTasks(phase.tasks),
      transition: transitionFor(phase.id, mode),
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
    name: mode === "vibe" ? "Vibe" : "Build",
    description: mode === "vibe" ? "Autonomous plan, build, review/fix, and pull-request publication" : BUILD_TEMPLATE.description,
    formatContext: (context) => formatBuildContext(context, mode),
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
      ...(mode === "vibe" ? [{
        id: "prepare",
        label: "🌿 Prepare topic branch",
        execution: "sequential" as const,
        contextMode: "full" as const,
        tasks: [{
          agent: "git-ops",
          requires: ["shell"],
          skill: ["git-attribution", "git-ops", "ship-mode"],
          model: "openai-codex/gpt-5.6-sol",
          task: [
            "Prepare a safe topic branch for this /vibe objective: {input}",
            "The explicit /vibe invocation authorizes inspection and creation of one local topic branch for this objective.",
            "Confirm the repository root, current branch, worktree status, remotes, default branch, and any existing pull request before making changes.",
            "If the current branch is protected or shared, create and switch to a clearly named topic branch without rewriting history. If it is already a suitable topic branch, keep it.",
            "Stop on unrelated or ambiguous dirty state, missing repository ownership, or any need for destructive operations, force, credentials, or shared writes.",
            "Do not edit files.",
            "Do not commit, push, or open a pull request in this phase.",
            "On success, return only JSON with exactly these fields: {\"status\":\"READY\",\"repository\":\"OWNER/REPO\",\"branch\":\"topic-branch\",\"base\":\"base-branch\"}.",
            "Use the canonical GitHub OWNER/REPO from the configured remote. The branch must differ from the base branch.",
            "If any stop condition applies, report the blocker instead. Do not return READY.",
          ].join("\n"),
        }],
        transition: transitionFor("prepare", mode),
      }] : []),
      buildPhases.plan,
      buildPhases.implement,
      { ...core, id: "core-review", label: "🔎 Core correctness and safety review", execution: "sequential", contextMode: "full", transition: transitionFor("core-review", mode) },
      {
        ...BUILD_TEMPLATE.selection,
        contextMode: "full",
        tasks: selectorTasks,
        transition: transitionFor("select-reviewers", mode),
      },
      {
        id: "specialist-review",
        label: "🔬 Relevant specialist reviews",
        execution: "parallel",
        contextMode: "full",
        tasks: (context) => createSharedReviewPhase(reviewContext,
          (context.state.selection as SelectionDecision[]).filter((decision) => decision.applicable).map((decision) => decision.agent),
        ).tasks as PhaseTask[],
        transition: transitionFor("specialist-review", mode),
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
      }, transitionFor("synthesize", mode)),
      buildPhases.fix,
      ...(mode === "vibe" ? [{
        id: "publish",
        label: "🚀 Publish pull request",
        execution: "sequential" as const,
        contextMode: "full" as const,
        tasks: [{
          agent: "git-ops",
          requires: ["shell"],
          skill: ["git-attribution", "git-ops", "pr-descriptions", "ship-mode"],
          model: "openai-codex/gpt-5.6-sol",
          task: [
            "Publish the clean reviewed work for: {input}",
            "The explicit /vibe invocation authorizes one scoped commit when needed, a normal push of the current topic branch, and creation or update of its pull request.",
            "Inspect the repository root, current branch, status, diff, attribution, and validation evidence before acting. Never commit unrelated or unexpected files.",
            "Stage only files that belong to this objective, verify the staged diff, create a conventional attributed commit with a useful body when changes are uncommitted, and push without force.",
            "Create or update the pull request with a concise description focused on why the change exists and how to use /vibe. Do not merge it.",
            "Afterward, fetch and verify the published commit is on the remote branch and the pull request is open for that branch.",
            "On success, return only JSON with exactly these fields: {\"status\":\"PUBLISHED\",\"repository\":\"OWNER/REPO\",\"branch\":\"topic-branch\",\"commit\":\"40-character SHA\",\"remoteCommit\":\"40-character SHA\",\"prUrl\":\"https://github.com/OWNER/REPO/pull/NUMBER\",\"prState\":\"OPEN\",\"scope\":\"OBJECTIVE_ONLY\"}.",
            "Set scope to OBJECTIVE_ONLY only after verifying that the commit contains no unrelated or unexpected files. The two commit fields must match.",
            "Stop for credentials, protected/shared branch writes, history rewrites, destructive operations, ambiguous ownership, or changes outside the objective. If any stop condition applies, report the blocker instead of returning PUBLISHED.",
            "Workflow evidence:",
            "{context}",
          ].join("\n"),
        }],
        transition: transitionFor("publish", mode),
      }] : []),
      buildPhases.finalize,
    ],
  };
}

class BuildExtension extends WorkflowExtensionCore {
  private readonly buildEngine = new WorkflowEngine(this.pi, createBuildWorkflow("build"));
  private readonly vibeEngine = new WorkflowEngine(this.pi, createBuildWorkflow("vibe"));

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
    this.registerLoopCommand("vibe", this.vibeEngine);
    this.registerStatusCommand("vibe:status", this.vibeEngine, "vibe");
  }

  private registerLoopCommand(name: BuildMode, engine: WorkflowEngine): void {
    this.pi.registerCommand(name, {
      description: name === "vibe"
        ? "Autonomously plan, build, review/fix, and open a pull request"
        : "Plan, implement, review, and apply bounded fixes",
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
          `Fix rounds: ${rounds}/${maxFixRounds(label === "vibe" ? "vibe" : "build")}`,
          `Verdict: ${verdict}`,
          ...(context.state.prUrl ? [`Pull request: ${context.state.prUrl}`] : []),
        ].join("\n"), "info");
      },
    });
  }
}

export default function build(pi: ExtensionAPI) {
  new BuildExtension(pi).register();
}
