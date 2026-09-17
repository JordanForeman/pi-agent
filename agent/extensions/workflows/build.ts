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
type BuildMode = "build" | "founder-mode";
type FounderPreparation = { status: "READY"; repository: string; branch: string; base: string };
type BlockerCategory = "safety" | "permissions" | "environment" | "format" | "agent-failure" | "decision" | "repair-limit";
type WorkflowBlocker = { phase: string; category: BlockerCategory; reason: string; action?: string };
type ParseOutcome<T> =
  | { kind: "valid"; value: T }
  | { kind: "repairable"; reason: string }
  | { kind: "blocked"; reason: string; category?: BlockerCategory };
type FormatRepair = { phaseId: string; key: string };

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
const FOUNDER_MODE_MAX_FIX_ROUNDS = 10;
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

function firstOutput(result: PhaseResult | undefined): string {
  return result?.outputs[0]?.result.trim() ?? "";
}

function firstLine(text: string, fallback: string): string {
  const line = text.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
  return line ? line.slice(0, 300) : fallback;
}

function reviewBlockerReason(result: PhaseResult): string {
  const lines = firstOutput(result).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const decisionPattern = /^(?:#+\s*)?(?:\*\*)?\d*\.?\s*(?:\*\*)?Decision needed(?:, if blocked)?(?:\*\*)?\s*:?\s*/i;
  const decisionIndex = lines.findIndex((line) => decisionPattern.test(line));
  if (decisionIndex >= 0) {
    const inline = lines[decisionIndex].replace(decisionPattern, "").replace(/\*\*$/, "").trim();
    if (inline && !/^none\.?$/i.test(inline)) return inline.slice(0, 300);
    const next = lines[decisionIndex + 1]?.replace(/^[-*]\s*/, "").replace(/^\*\*|\*\*$/g, "").trim();
    if (next && !/^none\.?$/i.test(next)) return next.slice(0, 300);
  }
  return "The review found a decision that could not be made safely from repository evidence.";
}

function unwrapJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function jsonPropertyNames(raw: string): string[] {
  const names: string[] = [];
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] !== '"') continue;
    const start = index;
    let escaped = false;
    for (index++; index < raw.length; index++) {
      const character = raw[index];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        break;
      }
    }
    if (index >= raw.length) break;
    let next = index + 1;
    while (/\s/.test(raw[next] ?? "")) next++;
    if (raw[next] !== ":") continue;
    try {
      const name = JSON.parse(raw.slice(start, index + 1));
      if (typeof name === "string") names.push(name);
    } catch {
      // JSON.parse reports malformed input; this scanner only detects duplicate keys.
    }
  }
  return names;
}

function propertyCount(raw: string, property: string): number {
  return jsonPropertyNames(raw).filter((name) => name === property).length;
}

function parseJsonRecord(raw: string, label: string): ParseOutcome<Record<string, unknown>> {
  const source = unwrapJson(raw);
  try {
    const value = JSON.parse(source);
    return value && typeof value === "object" && !Array.isArray(value)
      ? { kind: "valid", value: value as Record<string, unknown> }
      : { kind: "repairable", reason: `${label} was not a JSON object.` };
  } catch {
    return { kind: "repairable", reason: `${label} was not readable JSON.` };
  }
}

function reportedBlocker(value: Record<string, unknown>): string | null {
  return value.status === "BLOCKED"
    ? typeof value.reason === "string" && value.reason.trim() ? value.reason.trim() : "The agent reported that it could not continue safely."
    : null;
}

function expectedOutputAgent(context: WorkflowContext, phaseId: string, defaultAgent: string): string {
  const repair = context.state.formatRepair as FormatRepair | undefined;
  const repairedCurrentRound = (formatRepairAttempts(context)[repairKey(context, phaseId)] ?? 0) > 0;
  return repair?.phaseId === phaseId || repairedCurrentRound ? "planner" : defaultAgent;
}

function extractBuildVerdict(result: PhaseResult, context: WorkflowContext): ParseOutcome<BuildVerdict> {
  if (!successfulPhase(result, [expectedOutputAgent(context, "synthesize", "reviewer")])) {
    return { kind: "blocked", category: "agent-failure", reason: firstLine(firstOutput(result), "The review summary agent failed.") };
  }
  // Parse raw synthesis, never the lossy first-verdict receipt. Exactly one standalone line.
  const text = result.outputs[0].result;
  const tokens = text.match(/\bBUILD_[A-Z_]+\b/g) ?? [];
  if (tokens.length > 1) return { kind: "blocked", category: "format", reason: "The review summary contained conflicting verdicts." };
  if (tokens.length === 0) return { kind: "repairable", reason: "The review summary omitted its verdict." };
  const lines = text.split(/\r?\n/).filter((line) => /^\s*(?:\*\*)?Verdict\b/i.test(line));
  const match = lines.length === 1
    ? lines[0].match(/^\s*(?:\*\*)?Verdict(?:\*\*)?\s*:\s*(?:\*\*)?(BUILD_(?:CLEAN|FIXES_NEEDED|BLOCKED))(?:\*\*)?\s*$/)
    : null;
  return match
    ? { kind: "valid", value: match[1] as BuildVerdict }
    : { kind: "repairable", reason: "The review summary did not use the required verdict format." };
}

function parseFounderPreparation(result: PhaseResult): ParseOutcome<FounderPreparation> {
  if (!successfulPhase(result, ["git-ops"])) {
    return { kind: "blocked", category: "agent-failure", reason: firstLine(firstOutput(result), "Topic branch preparation failed.") };
  }
  const raw = unwrapJson(result.outputs[0].result);
  const parsed = parseJsonRecord(raw, "The topic branch result");
  if (parsed.kind !== "valid") return parsed;
  const value = parsed.value;
  const blocker = reportedBlocker(value);
  if (blocker) return { kind: "blocked", category: "safety", reason: blocker };
  for (const key of ["status", "repository", "branch", "base"]) {
    if (propertyCount(raw, key) > 1) return { kind: "blocked", category: "format", reason: `Topic branch proof contained duplicate ${key} fields.` };
  }
  if (value.status !== "READY" || typeof value.repository !== "string"
    || typeof value.branch !== "string" || typeof value.base !== "string") {
    return { kind: "repairable", reason: "The topic branch result omitted required proof." };
  }
  const repository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  const ref = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
  if (!repository.test(value.repository)) return { kind: "blocked", category: "environment", reason: "The configured remote did not identify a valid GitHub repository." };
  if (!ref.test(value.branch) || !ref.test(value.base) || value.branch === value.base
    || value.branch.includes("..") || value.branch.includes("//")) {
    return { kind: "blocked", category: "safety", reason: "The prepared topic branch or base branch was not safe to use." };
  }
  return { kind: "valid", value: value as FounderPreparation };
}

function extractPullRequestUrl(result: PhaseResult, context: WorkflowContext): ParseOutcome<string> {
  if (!successfulPhase(result, ["git-ops"])) {
    return { kind: "blocked", category: "agent-failure", reason: firstLine(firstOutput(result), "Pull request publication failed.") };
  }
  const raw = unwrapJson(result.outputs[0].result);
  const parsed = parseJsonRecord(raw, "The publication result");
  if (parsed.kind !== "valid") return parsed;
  const value = parsed.value;
  const blocker = reportedBlocker(value);
  if (blocker) return { kind: "blocked", category: "safety", reason: blocker };
  for (const key of ["status", "repository", "branch", "commit", "remoteCommit", "prUrl", "prState", "scope"]) {
    if (propertyCount(raw, key) > 1) return { kind: "blocked", category: "format", reason: `Publication proof contained duplicate ${key} fields.` };
  }
  if (typeof value.status !== "string" || typeof value.prState !== "string" || typeof value.scope !== "string"
    || typeof value.repository !== "string" || typeof value.branch !== "string"
    || typeof value.commit !== "string" || typeof value.remoteCommit !== "string" || typeof value.prUrl !== "string") {
    return { kind: "repairable", reason: "The publication result omitted required proof." };
  }
  if (value.status !== "PUBLISHED") return { kind: "blocked", category: "environment", reason: "Publication did not report success." };
  if (value.prState !== "OPEN") return { kind: "blocked", category: "environment", reason: "The pull request was not verified as open." };
  if (value.scope !== "OBJECTIVE_ONLY") return { kind: "blocked", category: "safety", reason: "The published commit was not limited to this objective." };
  if (value.repository !== context.state.repository) return { kind: "blocked", category: "safety", reason: "The pull request belongs to a different repository." };
  if (value.branch !== context.state.branch) return { kind: "blocked", category: "safety", reason: "The pull request belongs to a different branch." };
  if (!/^[0-9a-f]{40}$/i.test(value.commit) || value.remoteCommit !== value.commit) {
    return { kind: "blocked", category: "environment", reason: "The published commit was not verified on the remote branch." };
  }
  const match = value.prUrl.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+$/i);
  return match?.[1] === value.repository
    ? { kind: "valid", value: value.prUrl }
    : { kind: "blocked", category: "safety", reason: "The pull request URL did not match the verified repository." };
}

function parseSelection(result: PhaseResult | undefined, iteration: number, context: WorkflowContext): ParseOutcome<SelectionDecision[]> {
  if (!successfulPhase(result, [expectedOutputAgent(context, "select-reviewers", "pr-triage")], iteration)) {
    return { kind: "blocked", category: "agent-failure", reason: firstLine(firstOutput(result), "Reviewer selection failed.") };
  }
  const raw = unwrapJson(result!.outputs[0].result);
  const parsed = parseJsonRecord(raw, "The reviewer selection");
  if (parsed.kind !== "valid") return parsed;
  const value = parsed.value;
  if (propertyCount(raw, "decisions") > 1) return { kind: "blocked", category: "format", reason: "Reviewer selection contained duplicate decisions fields." };
  if (!Array.isArray(value.decisions) || value.decisions.length !== SPECIALIST_ROLES.length) {
    return { kind: "repairable", reason: "The reviewer selection did not include all four roles." };
  }
  for (const key of ["agent", "applicable", "reason"]) {
    if (propertyCount(raw, key) > SPECIALIST_ROLES.length) {
      return { kind: "blocked", category: "format", reason: `Reviewer selection contained duplicate ${key} fields.` };
    }
  }
  const seen = new Set<string>();
  for (const decision of value.decisions) {
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
      return { kind: "repairable", reason: "A reviewer selection entry was incomplete." };
    }
    const item = decision as Record<string, unknown>;
    if (typeof item.agent !== "string" || !SPECIALIST_ROLES.includes(item.agent as typeof SPECIALIST_ROLES[number]) || seen.has(item.agent)
      || typeof item.applicable !== "boolean" || typeof item.reason !== "string" || !item.reason.trim()) {
      return { kind: "blocked", category: "format", reason: "Reviewer selection contained an invalid or duplicate role decision." };
    }
    seen.add(item.agent);
  }
  return { kind: "valid", value: value.decisions as SelectionDecision[] };
}

function fixRounds(context: WorkflowContext): number {
  return typeof context.state.fixRounds === "number" ? context.state.fixRounds : 0;
}

function formatRepairAttempts(context: WorkflowContext): Record<string, number> {
  const value = context.state.formatRepairAttempts;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, number> : {};
}

function repairKey(context: WorkflowContext, phaseId: string): string {
  const round = phaseId === "select-reviewers" || phaseId === "synthesize" ? fixRounds(context) + 1 : 1;
  return `${phaseId}:${round}`;
}

function repairCount(context: WorkflowContext, phaseId: string): number {
  return Object.entries(formatRepairAttempts(context))
    .filter(([key]) => key.startsWith(`${phaseId}:`))
    .reduce((total, [, count]) => total + count, 0);
}

function expectedIteration(context: WorkflowContext, phaseId: string, logicalIteration: number): number {
  return logicalIteration + repairCount(context, phaseId);
}

function clearFormatRepair(context: WorkflowContext, phaseId: string): void {
  const repair = context.state.formatRepair as FormatRepair | undefined;
  if (repair?.phaseId === phaseId) delete context.state.formatRepair;
}

function blockBuild(context: WorkflowContext, blocker: WorkflowBlocker): string {
  context.state.finalVerdict = "BUILD_BLOCKED";
  context.state.blocker = blocker;
  context.state.blockedReason = blocker.reason;
  return "finalize";
}

function requestFormatRepair(context: WorkflowContext, phaseId: string, result: PhaseResult, reason: string): string {
  const key = repairKey(context, phaseId);
  const attempts = formatRepairAttempts(context);
  if ((attempts[key] ?? 0) >= 1) {
    return blockBuild(context, {
      phase: phaseId,
      category: "format",
      reason: phaseId === "select-reviewers"
        ? "I could not read the reviewer selection after one automatic format retry."
        : `I could not read the ${phaseId} result after one automatic format retry.`,
      action: "Restart /founder-mode. If this repeats, inspect the phase output for the underlying agent error.",
    });
  }
  attempts[key] = 1;
  context.state.formatRepairAttempts = attempts;
  context.state.formatRepair = { phaseId, key } satisfies FormatRepair;
  context.state.lastFormatIssue = reason;
  // Do not reinject the malformed response into the retry prompt.
  delete context.phases[phaseId];
  return phaseId;
}

function reviewPrerequisites(context: WorkflowContext, includeSelection = true, includeSpecialists = true): boolean {
  const round = fixRounds(context) + 1;
  if (!successfulPhase(context.phases.plan, ["planner"])
    || !successfulPhase(context.phases.implement, ["builder"])
    || !successfulPhase(context.phases["core-review"], ["reviewer"], round)) return false;
  if (!includeSelection) return true;
  const selection = parseSelection(context.phases["select-reviewers"], expectedIteration(context, "select-reviewers", round), context);
  if (selection.kind !== "valid") return false;
  const agents = selection.value.filter((decision) => decision.applicable).map((decision) => decision.agent);
  // Specialist phase iterations count dispatches, not rounds (zero selection skips it).
  return !includeSpecialists || agents.length === 0 || successfulPhase(context.phases["specialist-review"], agents);
}

function maxFixRounds(mode: BuildMode): number {
  return mode === "founder-mode" ? FOUNDER_MODE_MAX_FIX_ROUNDS : BUILD_TEMPLATE.maxFixRounds;
}

function templateTasks(tasks: BuildTaskSpec[], mode?: BuildMode, phaseId?: string): PhaseTask[] {
  return tasks.map((task) => {
    let prompt = task.lines.join("\n");
    if (mode === "founder-mode" && phaseId && ["plan", "implement", "fix"].includes(phaseId)) {
      prompt += [
        "",
        "/founder-mode autonomy policy:",
        "- Turn the general objective into the smallest coherent, reversible solution supported by repository evidence.",
        "- Infer routine product, scope, UX, and architecture details from existing conventions. Record material assumptions instead of asking for approval.",
        "- Do not stop because several safe choices exist. Choose the simplest option that satisfies the objective.",
        "- Stop only when no safe reversible choice exists, requirements conflict, or credentials, ownership, destructive operations, protected/shared writes, or material security risk require user action.",
      ].join("\n");
    }
    if (mode === "founder-mode" && phaseId === "finalize") {
      prompt = [
        "Summarize the final /founder-mode outcome for: {input}",
        "Do not edit files or delegate.",
        "Use plain language. Do not expose internal verdict tokens, phase-contract jargon, or parent-review language.",
        "Lead with the result or the exact reason work stopped.",
        "If stopped, state what completed, the automatic recovery attempted, and the exact user action still required.",
        "If successful, include the pull request URL, changed files, and validation evidence.",
        "Mention repair attempts only when at least one was used.",
        "",
        "Workflow evidence:",
        "{context}",
      ].join("\n");
    }
    return {
      agent: task.agent,
      requires: task.requires,
      task: prompt,
      ...(task.skill ? { skill: task.skill } : {}),
      ...(task.model !== undefined ? { model: task.model } : {}),
    };
  });
}

function formatRepairTasks(
  context: WorkflowContext,
  phaseId: string,
  tasks: PhaseTask[],
  contract: string,
  restriction: string,
): PhaseTask[] {
  const repair = context.state.formatRepair as FormatRepair | undefined;
  if (repair?.phaseId !== phaseId) return tasks;
  return tasks.map((task) => ({
    ...task,
    agent: "planner",
    requires: [],
    skill: ["concise-output", "read-only"],
    task: [
      "FORMAT REPAIR ONLY.",
      "The prior response was unreadable and has been removed from context.",
      "Recreate this read-only result from the existing workflow evidence. Do not invent missing evidence.",
      restriction,
      contract,
      "Return only the required output.",
      "",
      task.task,
    ].join("\n"),
  }));
}

function transitionFor(phaseId: string, mode: BuildMode): TransitionRule {
  if (phaseId === "finalize") return { type: "advance" };
  return {
    type: "conditional",
    decide: (result, context) => {
      if (phaseId === "synthesize") {
        const round = fixRounds(context) + 1;
        if (!reviewPrerequisites(context) || result.iteration !== expectedIteration(context, "synthesize", round)) {
          return blockBuild(context, { phase: phaseId, category: "agent-failure", reason: "The current review evidence was incomplete." });
        }
        const parsed = extractBuildVerdict(result, context);
        if (parsed.kind === "repairable") {
          return mode === "founder-mode"
            ? requestFormatRepair(context, phaseId, result, parsed.reason)
            : blockBuild(context, { phase: phaseId, category: "format", reason: parsed.reason });
        }
        if (parsed.kind === "blocked") {
          return blockBuild(context, { phase: phaseId, category: parsed.category ?? "agent-failure", reason: parsed.reason });
        }
        clearFormatRepair(context, phaseId);
        const verdict = parsed.value;
        context.state.finalVerdict = verdict;
        if (verdict === "BUILD_BLOCKED") {
          return blockBuild(context, { phase: phaseId, category: "decision", reason: reviewBlockerReason(result) });
        }
        if (verdict === "BUILD_FIXES_NEEDED") {
          if (fixRounds(context) < maxFixRounds(mode)) {
            context.state.fixRounds = fixRounds(context) + 1;
            return "fix";
          }
          const blocker: WorkflowBlocker = {
            phase: phaseId,
            category: "repair-limit",
            reason: `The workflow used all ${maxFixRounds(mode)} repair attempts, but review still found work to do.`,
            action: "Inspect the final review findings, then restart with a narrower objective or address the remaining issue directly.",
          };
          context.state.blocker = blocker;
          context.state.blockedReason = blocker.reason;
        }
        if (verdict === "BUILD_CLEAN" && mode === "founder-mode") return "publish";
        return "finalize";
      }
      if (phaseId === "publish") {
        const parsed = extractPullRequestUrl(result, context);
        if (parsed.kind === "repairable") {
          return blockBuild(context, { phase: phaseId, category: "format", reason: parsed.reason });
        }
        if (parsed.kind === "blocked") {
          return blockBuild(context, { phase: phaseId, category: parsed.category ?? "agent-failure", reason: parsed.reason });
        }
        clearFormatRepair(context, phaseId);
        context.state.prUrl = parsed.value;
        return "finalize";
      }
      if (phaseId === "prepare") {
        const parsed = parseFounderPreparation(result);
        if (parsed.kind === "repairable") {
          return blockBuild(context, { phase: phaseId, category: "format", reason: parsed.reason });
        }
        if (parsed.kind === "blocked") {
          return blockBuild(context, { phase: phaseId, category: parsed.category ?? "agent-failure", reason: parsed.reason });
        }
        clearFormatRepair(context, phaseId);
        const { repository, branch, base } = parsed.value;
        Object.assign(context.state, { repository, branch, base });
        return "plan";
      }
      if (phaseId === "select-reviewers") {
        if (!reviewPrerequisites(context, false)) {
          return blockBuild(context, { phase: phaseId, category: "agent-failure", reason: "The core review evidence was incomplete." });
        }
        const round = fixRounds(context) + 1;
        const parsed = parseSelection(result, expectedIteration(context, phaseId, round), context);
        if (parsed.kind === "repairable") {
          return mode === "founder-mode"
            ? requestFormatRepair(context, phaseId, result, parsed.reason)
            : blockBuild(context, { phase: phaseId, category: "format", reason: parsed.reason });
        }
        if (parsed.kind === "blocked") {
          return blockBuild(context, { phase: phaseId, category: parsed.category ?? "agent-failure", reason: parsed.reason });
        }
        clearFormatRepair(context, phaseId);
        context.state.selection = parsed.value;
        return parsed.value.some((decision) => decision.applicable) ? "specialist-review" : "synthesize";
      }
      if (phaseId === "specialist-review") {
        return reviewPrerequisites(context)
          ? "synthesize"
          : blockBuild(context, { phase: phaseId, category: "agent-failure", reason: "A selected specialist review failed or returned no usable evidence." });
      }
      const agent = phaseId === "plan" ? "planner" : phaseId === "core-review" ? "reviewer" : "builder";
      if (!successfulPhase(result, [agent])) {
        return blockBuild(context, {
          phase: phaseId,
          category: "agent-failure",
          reason: firstLine(firstOutput(result), `The ${phaseId} phase failed or returned no usable evidence.`),
        });
      }
      if (phaseId === "fix") {
        const evidence = context.state.fixEvidence as PhaseResult[];
        evidence.push(result);
        // Active review evidence belongs to exactly one round. Do not reinject old findings/verdicts.
        for (const id of ["core-review", "select-reviewers", "specialist-review", "synthesize", "fix"]) delete context.phases[id];
        delete context.state.selection;
        delete context.state.blockedReason;
        delete context.state.blocker;
        context.state.finalVerdict = null;
        return "core-review";
      }
      if (phaseId === "core-review") {
        return reviewPrerequisites(context, false)
          ? "select-reviewers"
          : blockBuild(context, { phase: phaseId, category: "agent-failure", reason: "Planning or implementation evidence was incomplete." });
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
  const blocker = context.state.blocker as WorkflowBlocker | undefined;
  const rounds = fixRounds(context);
  const outcome = context.state.prUrl ? "pull request published" : blocker ? "stopped" : "in progress";
  return [
    mode === "founder-mode" ? "Founder mode state:" : "Build state:",
    mode === "founder-mode"
      ? `- Outcome: ${outcome}`
      : `- Final verdict: ${typeof context.state.finalVerdict === "string" ? context.state.finalVerdict : "pending"}`,
    ...(rounds > 0 ? [mode === "founder-mode"
      ? `- Repair attempts used: ${rounds} (limit: ${maxFixRounds(mode)})`
      : `- Fix rounds: ${rounds}/${maxFixRounds(mode)}`] : []),
    ...(context.state.prUrl ? [`- Pull request: ${context.state.prUrl}`] : []),
    ...(blocker ? [
      `- Stopped during: ${blocker.phase}`,
      `- Reason: ${blocker.reason}`,
      ...(blocker.action ? [`- User action: ${blocker.action}`] : []),
    ] : []),
    "",
    ...active,
    ...fixEvidence,
    ...background,
  ].join("\n\n");
}

export function createBuildWorkflow(commandName: string): WorkflowDefinition {
  const mode: BuildMode = commandName === "founder-mode" ? "founder-mode" : "build";
  const buildPhases = Object.fromEntries(
    BUILD_TEMPLATE.phases.map((phase) => [phase.id, {
      id: phase.id,
      label: phase.label,
      execution: phase.execution,
      // Retain raw evidence so an empty successful child cannot pass a receipt-only check.
      contextMode: "full",
      tasks: templateTasks(phase.tasks, mode, phase.id),
      transition: transitionFor(phase.id, mode),
    }]),
  ) as Record<string, WorkflowDefinition["phases"][number]>;

  const reviewContext = { review_context: "Original objective: {input}\nCurrent build context:\n{context}" };
  const core = createSharedReviewPhase(reviewContext, ["reviewer"]);
  const coreTasks = core.tasks as PhaseTask[];
  if (BUILD_TEMPLATE.reviewModels.core !== undefined) coreTasks[0].model = BUILD_TEMPLATE.reviewModels.core;
  const selectorTasks = templateTasks(BUILD_TEMPLATE.selection.tasks);
  if (BUILD_TEMPLATE.reviewModels.selector !== undefined) selectorTasks[0].model = BUILD_TEMPLATE.reviewModels.selector;
  const synthesis = createSharedReviewSynthesisPhase({
    verdict_instructions: [
      "Return exactly one standalone verdict line (no suffix, no other BUILD_* tokens):",
      "Verdict: BUILD_CLEAN",
      "or Verdict: BUILD_FIXES_NEEDED",
      "or Verdict: BUILD_BLOCKED",
      "Choose clean only when no blockers or worthwhile fixes remain.",
      "Choose fixes-needed for code fixes, missing tests, incomplete validation, or reversible product, scope, UX, and architecture choices that the builder can resolve from repository evidence.",
      "Choose blocked only for conflicting requirements or a consequential decision that cannot be made safely and reversibly, including credentials, ownership, destructive operations, protected/shared writes, or material security risk.",
      "Use only current-round core/selection/specialist findings. Fix evidence records prior implementation, not unresolved reviewer findings.",
      "",
      "Then provide:",
      "1. Accepted fixes worth doing now (file-specific)",
      "2. Optional/deferred feedback",
      "3. Validation still required",
      "4. Decision needed, if blocked",
    ].join("\n"),
  }, transitionFor("synthesize", mode));
  const synthesisTasks = synthesis.tasks as PhaseTask[];

  return {
    id: commandName,
    name: mode === "founder-mode" ? "Founder Mode" : "Build",
    description: mode === "founder-mode" ? "Autonomous plan, build, review/fix, and pull-request publication" : BUILD_TEMPLATE.description,
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
        formatRepairAttempts: {},
      },
    }),
    phases: [
      ...(mode === "founder-mode" ? [{
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
            "Prepare a safe topic branch for this /founder-mode objective: {input}",
            "The explicit /founder-mode invocation authorizes inspection and creation of one local topic branch for this objective.",
            "Confirm the repository root, current branch, worktree status, remotes, default branch, and any existing pull request before making changes.",
            "If the current branch is protected or shared, create and switch to a clearly named topic branch without rewriting history. If it is already a suitable topic branch, keep it.",
            "Preserve unrelated dirty files. Continue when they do not overlap the objective and branch preparation cannot overwrite, lose, stage, or commit them.",
            "Stop when existing changes overlap likely objective files, ownership is unclear, safe isolation is unavailable, or any destructive operation, force, credential, or shared write is required.",
            "Do not edit files.",
            "Do not commit, push, or open a pull request in this phase.",
            "On success, return only JSON with these required fields: {\"status\":\"READY\",\"repository\":\"OWNER/REPO\",\"branch\":\"topic-branch\",\"base\":\"base-branch\"}.",
            "Use the canonical GitHub OWNER/REPO from the configured remote. The branch must differ from the base branch.",
            "If any stop condition applies, return JSON with status BLOCKED and a plain-language reason. Do not return READY.",
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
        tasks: (context: WorkflowContext) => formatRepairTasks(
          context,
          "select-reviewers",
          selectorTasks,
          "Return JSON with one decisions array and one decision for each required reviewer role.",
          "Do not inspect files or run commands.",
        ),
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
      {
        ...synthesis,
        tasks: (context: WorkflowContext) => formatRepairTasks(
          context,
          "synthesize",
          synthesisTasks,
          "Return exactly one standalone verdict line: Verdict: BUILD_CLEAN, Verdict: BUILD_FIXES_NEEDED, or Verdict: BUILD_BLOCKED.",
          "Do not inspect files, run commands, or change the review decision.",
        ),
      },
      buildPhases.fix,
      ...(mode === "founder-mode" ? [{
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
            "The explicit /founder-mode invocation authorizes one scoped commit when needed, a normal push of the current topic branch, and creation or update of its pull request.",
            "Inspect the repository root, current branch, status, diff, attribution, and validation evidence before acting. Never commit unrelated or unexpected files.",
            "Stage only files that belong to this objective, verify the staged diff, create a conventional attributed commit with a useful body when changes are uncommitted, and push without force.",
            "Create or update the pull request with a concise description focused on why the change exists and how to use /founder-mode. Do not merge it.",
            "Afterward, fetch and verify the published commit is on the remote branch and the pull request is open for that branch.",
            "On success, return only JSON with these required fields: {\"status\":\"PUBLISHED\",\"repository\":\"OWNER/REPO\",\"branch\":\"topic-branch\",\"commit\":\"40-character SHA\",\"remoteCommit\":\"40-character SHA\",\"prUrl\":\"https://github.com/OWNER/REPO/pull/NUMBER\",\"prState\":\"OPEN\",\"scope\":\"OBJECTIVE_ONLY\"}.",
            "Set scope to OBJECTIVE_ONLY only after verifying that the commit contains no unrelated or unexpected files. The two commit fields must match.",
            "Stop for credentials, protected/shared branch writes, history rewrites, destructive operations, ambiguous ownership, or changes outside the objective. If any stop condition applies, return JSON with status BLOCKED and a plain-language reason.",
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
  private readonly founderModeEngine = new WorkflowEngine(this.pi, createBuildWorkflow("founder-mode"));

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
    this.registerLoopCommand("founder-mode", this.founderModeEngine);
    this.registerStatusCommand("founder-mode:status", this.founderModeEngine, "founder-mode");
  }

  private registerLoopCommand(name: BuildMode, engine: WorkflowEngine): void {
    this.pi.registerCommand(name, {
      description: name === "founder-mode"
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
        const blocker = context.state.blocker as WorkflowBlocker | undefined;
        const reviewing = Boolean(context.currentPhase && ["core-review", "select-reviewers", "specialist-review", "synthesize", "fix"].includes(context.currentPhase));

        ctx.ui.notify([
          `${definition.name}: ${engineState}`,
          `Objective: ${context.input}`,
          phase ? `Current: ${phase.label}` : "Current: (none)",
          ...(blocker ? [`Stopped during: ${blocker.phase}`] : []),
          ...(label === "founder-mode"
            ? rounds > 0 || reviewing ? [`Repair attempts used: ${rounds} (limit: ${maxFixRounds("founder-mode")})`] : []
            : [`Fix rounds: ${rounds}/${maxFixRounds("build")}`, `Verdict: ${verdict}`]),
          ...(blocker ? [`Reason: ${blocker.reason}`, ...(blocker.action ? [`User action: ${blocker.action}`] : [])] : []),
          ...(context.state.prUrl ? [`Pull request: ${context.state.prUrl}`] : []),
        ].join("\n"), "info");
      },
    });
  }
}

export default function build(pi: ExtensionAPI) {
  new BuildExtension(pi).register();
}
