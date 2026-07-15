import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type PhaseContextMode,
  type PhaseDefinition,
  type PhaseExecution,
  type PhaseTask,
  type TransitionRule,
} from "./workflow-engine";

type ReviewTaskSpec = {
  agent: string;
  skill?: string[];
  lines: string[];
};

type ReviewPhaseSpec = {
  id: string;
  label: string;
  execution: PhaseExecution;
  contextMode?: PhaseContextMode;
  tasks: ReviewTaskSpec[];
};

type ReviewContract = {
  description: string;
  review: ReviewPhaseSpec;
  synthesize: ReviewPhaseSpec;
};

type TemplateReplacements = Record<string, string>;

const REVIEW_CONTRACT = loadReviewContract();

export function createSharedReviewPhase(replacements: TemplateReplacements): PhaseDefinition {
  return materializePhase(REVIEW_CONTRACT.review, replacements, { type: "advance" });
}

export function createSharedReviewSynthesisPhase(
  replacements: TemplateReplacements,
  transition: TransitionRule = { type: "advance" },
): PhaseDefinition {
  return materializePhase(REVIEW_CONTRACT.synthesize, replacements, transition);
}

function loadReviewContract(): ReviewContract {
  const contractPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "review.workflow.json");
  return validateReviewContract(JSON.parse(fs.readFileSync(contractPath, "utf8")));
}

function materializePhase(spec: ReviewPhaseSpec, replacements: TemplateReplacements, transition: TransitionRule): PhaseDefinition {
  return {
    id: spec.id,
    label: spec.label,
    execution: spec.execution,
    contextMode: spec.contextMode,
    tasks: spec.tasks.map((task) => ({
      agent: task.agent,
      task: materializeLines(task.lines, replacements),
      ...(task.skill ? { skill: task.skill } : {}),
    })),
    transition,
  };
}

function materializeLines(lines: string[], replacements: TemplateReplacements): string {
  return lines
    .map((line) => Object.entries(replacements).reduce(
      (result, [key, value]) => result.replaceAll(`{${key}}`, value),
      line,
    ))
    .join("\n");
}

function validateReviewContract(value: unknown): ReviewContract {
  const contract = asRecord(value, "review contract");
  const review = validatePhaseSpec(contract.review, "review");
  const synthesize = validatePhaseSpec(contract.synthesize, "synthesize");

  if (review.id !== "review") {
    throw new Error('review.workflow.json: review.id must be "review"');
  }

  if (synthesize.id !== "synthesize") {
    throw new Error('review.workflow.json: synthesize.id must be "synthesize"');
  }

  return {
    description: asString(contract.description, "description"),
    review,
    synthesize,
  };
}

function validatePhaseSpec(value: unknown, label: string): ReviewPhaseSpec {
  const phase = asRecord(value, label);
  const execution = asString(phase.execution, `${label}.execution`);
  const contextMode = phase.contextMode === undefined ? undefined : asString(phase.contextMode, `${label}.contextMode`);
  const tasks = asArray(phase.tasks, `${label}.tasks`).map((task, index) => validateTaskSpec(task, label, index));

  if (tasks.length === 0) {
    throw new Error(`review.workflow.json: ${label}.tasks must not be empty`);
  }

  if (execution !== "sequential" && execution !== "parallel") {
    throw new Error(`review.workflow.json: ${label}.execution must be sequential or parallel`);
  }

  if (contextMode !== undefined && !["full", "compact", "file-only", "none"].includes(contextMode)) {
    throw new Error(`review.workflow.json: ${label}.contextMode is invalid`);
  }

  return {
    id: asString(phase.id, `${label}.id`),
    label: asString(phase.label, `${label}.label`),
    execution,
    contextMode: contextMode as PhaseContextMode | undefined,
    tasks,
  };
}

function validateTaskSpec(value: unknown, phaseLabel: string, taskIndex: number): ReviewTaskSpec {
  const task = asRecord(value, `${phaseLabel}.tasks[${taskIndex}]`);
  const lines = asArray(task.lines, `${phaseLabel}.tasks[${taskIndex}].lines`).map((line, index) => {
    if (typeof line !== "string") {
      throw new Error(`review.workflow.json: ${phaseLabel}.tasks[${taskIndex}].lines[${index}] must be a string`);
    }
    return line;
  });

  if (!lines.some((line) => line.trim() !== "")) {
    throw new Error(`review.workflow.json: ${phaseLabel}.tasks[${taskIndex}].lines must include prompt text`);
  }

  const skill = task.skill === undefined
    ? undefined
    : asArray(task.skill, `${phaseLabel}.tasks[${taskIndex}].skill`).map((item, index) => asString(item, `skill[${index}]`));

  return {
    agent: asString(task.agent, `${phaseLabel}.tasks[${taskIndex}].agent`),
    skill,
    lines,
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`review.workflow.json: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`review.workflow.json: ${label} must be an array`);
  }
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`review.workflow.json: ${label} must be a non-empty string`);
  }
  return value;
}
