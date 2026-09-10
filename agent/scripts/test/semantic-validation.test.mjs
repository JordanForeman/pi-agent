import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractWorkflowContracts,
  validateAgentContent,
  validateClassifierDocumentation,
  validatePromptContent,
  validateSettingsPromptPaths,
  validateSkillCategoryCounts,
  validateWorkflowSource,
  validateWorkflowTaskSpecs,
} from "../lib/semantic-validation.mjs";

const fixture = async (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const messages = (diagnostics) => diagnostics.join("\n");

test("prompt validation rejects stale payload fields and unknown references", async () => {
  const diagnostics = validatePromptContent({
    content: await fixture("prompt-stale.md"),
    filePath: "prompt-stale.md",
    agentNames: new Set(["architect"]),
    workflowIds: new Set(["tdd"]),
    skillNames: new Set(["testing"]),
  });

  assert.match(messages(diagnostics), /obsolete subagent tool field "subagent"/);
  assert.match(messages(diagnostics), /obsolete subagent tool field "relation"/);
  assert.match(messages(diagnostics), /unknown subagent "missing-agent"/);
  assert.match(messages(diagnostics), /unknown workflow "missing-workflow"/);
  assert.match(messages(diagnostics), /unknown skill "missing-skill"/);
});

test("prompt validation accepts the current agent/task schema", () => {
  const content = `---\ndescription: Current prompt\nsubagents: [architect]\nworkflow: tdd\n---\n\`\`\`json\n{"agent":"architect","task":"Inspect"}\n\`\`\``;
  assert.deepEqual(validatePromptContent({
    content,
    filePath: "valid.md",
    agentNames: new Set(["architect"]),
    workflowIds: new Set(["tdd"]),
  }), []);
});

test("skill evaluation prompt keeps candidate and judge orchestration in the parent", async () => {
  const content = await readFile(new URL("../../prompts/analyze/skill-eval.md", import.meta.url), "utf8");
  assert.doesNotMatch(content, /^subagents:/m);
  assert.doesNotMatch(content, /"agent"\s*:/);
  assert.match(content, /In the parent session, load and follow `skill-evaluation` plus `evidence-report`/);
  assert.match(content, /isolated candidate\/judge workflow/);
});

test("settings validation rejects stale paths and accepts complete canonical discovery", async () => {
  const stale = JSON.parse(await fixture("settings-stale.json"));
  const staleDiagnostics = validateSettingsPromptPaths({
    promptPaths: stale.prompts,
    categories: ["ship", "analyze", "plan", "learn"],
    promptFiles: ["ship/verify.md", "analyze/arch.md", "plan/plan.md", "learn/learn.md"],
  });
  assert.match(messages(staleDiagnostics), /prompt paths must exactly match/);

  assert.deepEqual(validateSettingsPromptPaths({
    promptPaths: [
      "../agent/prompts/ship",
      "../agent/prompts/analyze",
      "../agent/prompts/plan",
      "../agent/prompts/learn",
    ],
    categories: ["ship", "analyze", "plan", "learn"],
    promptFiles: ["ship/verify.md", "analyze/arch.md", "plan/plan.md", "learn/learn.md"],
  }), []);
});

test("workflow validation rejects unknown agents and capability mismatches", async () => {
  const source = await fixture("workflow-invalid.ts");
  assert.equal(extractWorkflowContracts(source, "workflow-invalid.ts").length, 1);

  const diagnostics = validateWorkflowSource({
    source,
    filePath: "workflow-invalid.ts",
    agentCapabilities: new Map([
      ["builder", new Set(["filesystem-write", "shell"])],
      ["testing-reviewer", new Set(["shell"])],
    ]),
    knownAgents: new Set(["builder", "testing-reviewer"]),
  });
  assert.match(messages(diagnostics), /unknown workflow agent "missing-agent"/);

  const mismatch = source.replace("missing-agent", "testing-reviewer");
  assert.match(messages(validateWorkflowSource({
    source: mismatch,
    filePath: "workflow-invalid.ts",
    agentCapabilities: new Map([["testing-reviewer", new Set(["shell"])]]),
    knownAgents: new Set(["testing-reviewer"]),
  })), /requires capability "filesystem-write"/);

  const dynamic = source.replace('"missing-agent"', "selectedAgent");
  assert.match(messages(validateWorkflowSource({
    source: dynamic,
    filePath: "workflow-invalid.ts",
    agentCapabilities: new Map(),
    knownAgents: new Set(),
  })), /agent must be a static string literal/);

  const valid = source.replace("missing-agent", "builder");
  const unknownSkill = valid.replace("task:", 'skill: ["missing-skill"],\n      task:');
  assert.match(messages(validateWorkflowSource({
    source: unknownSkill,
    filePath: "workflow-invalid.ts",
    agentCapabilities: new Map([["builder", new Set(["filesystem-write", "shell"])]]),
    knownAgents: new Set(["builder"]),
    skillNames: new Set(["known-skill"]),
  })), /unknown skill "missing-skill"/);

  assert.deepEqual(validateWorkflowSource({
    source: valid,
    filePath: "workflow-invalid.ts",
    agentCapabilities: new Map([["builder", new Set(["filesystem-write", "shell"])]]),
    knownAgents: new Set(["builder"]),
  }), []);
});

test("workflow validation rejects skill metadata placed after another task property", () => {
  const source = `{
    agent: "builder",
    requires: ["filesystem-write", "shell"],
    task: "Implement the change",
    skill: ["missing-skill"],
  }`;
  const [task] = extractWorkflowContracts(source, "workflow-late-skill.ts");

  assert.deepEqual(task.skills, []);
  assert.equal(task.hasLateSkill, true);
  assert.match(messages(validateWorkflowSource({
    source,
    filePath: "workflow-late-skill.ts",
    agentCapabilities: new Map([["builder", new Set(["filesystem-write", "shell"])]]),
    knownAgents: new Set(["builder"]),
    skillNames: new Set(["known-skill"]),
  })), /must declare skill immediately after requires/);
});

test("workflow validation rejects the original TDD writer regression without capability metadata", async () => {
  const source = await fixture("workflow-missing-requires.ts");
  const [task] = extractWorkflowContracts(source, "workflow-missing-requires.ts");
  assert.equal(task.declaresRequires, false);

  const diagnostics = validateWorkflowSource({
    source,
    filePath: "workflow-missing-requires.ts",
    agentCapabilities: new Map([["builder", new Set(["filesystem-write", "shell"])]]),
    knownAgents: new Set(["builder"]),
  });
  assert.match(messages(diagnostics), /must declare an explicit requires array/);
});

test("workflow extraction does not borrow unrelated later requires metadata", () => {
  const source = `{
    agent: "builder",
    task: "Implement the change",
    metadata: { requires: ["filesystem-write", "shell"] },
  }`;
  const [task] = extractWorkflowContracts(source, "workflow-unrelated-requires.ts");

  assert.equal(task.declaresRequires, false);
  assert.deepEqual(task.requires, []);
  assert.match(messages(validateWorkflowSource({
    source,
    filePath: "workflow-unrelated-requires.ts",
    agentCapabilities: new Map([["builder", new Set(["filesystem-write", "shell"])]]),
    knownAgents: new Set(["builder"]),
  })), /must declare an explicit requires array/);
});

test("JSON workflow tasks declare valid agent capabilities", async () => {
  const specs = await Promise.all([
    readFile(new URL("../../extension-core/review.workflow.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../extensions/workflows/build.workflow.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const tasks = specs.flatMap((spec) => {
    const phases = spec.phases ?? [spec.review, spec.synthesize];
    return phases.flatMap((phase) => phase.tasks);
  });
  const writable = new Set(["filesystem-write", "shell"]);
  const shell = new Set(["shell"]);
  const agentCapabilities = new Map(tasks.map((task) => [task.agent, task.agent === "builder" ? writable : shell]));
  agentCapabilities.set("planner", new Set());
  agentCapabilities.set("reviewer", shell);

  assert.deepEqual(validateWorkflowTaskSpecs({
    tasks,
    filePath: "workflow specs",
    agentCapabilities,
    knownAgents: new Set(agentCapabilities.keys()),
    skillNames: new Set(tasks.flatMap((task) => task.skill ?? [])),
  }), []);
});

test("JSON workflow validation rejects missing metadata, unknown agents, and mismatches", () => {
  const diagnostics = validateWorkflowTaskSpecs({
    tasks: [
      { agent: "builder" },
      { agent: "missing", requires: [] },
      { agent: "reader", requires: ["filesystem-write"], skill: ["missing-skill"] },
    ],
    filePath: "invalid.workflow.json",
    agentCapabilities: new Map([
      ["builder", new Set(["filesystem-write", "shell"])],
      ["reader", new Set(["shell"])],
    ]),
    knownAgents: new Set(["builder", "reader"]),
    skillNames: new Set(["known-skill"]),
  });

  assert.match(messages(diagnostics), /builder.*explicit requires array/);
  assert.match(messages(diagnostics), /unknown workflow agent "missing"/);
  assert.match(messages(diagnostics), /reader.*requires capability "filesystem-write"/);
  assert.match(messages(diagnostics), /reader.*unknown skill "missing-skill"/);
});

test("all live workflow tasks declare explicit capabilities", async () => {
  const sources = await Promise.all([
    readFile(new URL("../../extensions/workflows/tdd.ts", import.meta.url), "utf8"),
    readFile(new URL("../../extensions/workflows/triage.ts", import.meta.url), "utf8"),
    readFile(new URL("../../extensions/workflows/pr-review.ts", import.meta.url), "utf8"),
    readFile(new URL("../../extensions/workflows/research.ts", import.meta.url), "utf8"),
    readFile(new URL("../../extensions/workflows/verify.ts", import.meta.url), "utf8"),
    readFile(new URL("../../extensions/ralph-loop.ts", import.meta.url), "utf8"),
  ]);
  const [tddTasks, triageTasks, prReviewTasks, researchTasks, verifyTasks, ralphTasks] = sources.map((source) => extractWorkflowContracts(source));

  assert.deepEqual([tddTasks.length, triageTasks.length, prReviewTasks.length, researchTasks.length, verifyTasks.length, ralphTasks.length], [3, 3, 1, 1, 1, 3]);
  for (const task of [...tddTasks, ...triageTasks, ...prReviewTasks, ...researchTasks, ...verifyTasks, ...ralphTasks]) {
    assert.equal(task.declaresRequires, true, `${task.agent} must declare requires`);
  }
  assert.deepEqual(tddTasks.map(({ agent, requires }) => ({ agent, requires })), [
    { agent: "builder", requires: ["filesystem-write", "shell"] },
    { agent: "builder", requires: ["filesystem-write", "shell"] },
    { agent: "builder", requires: ["filesystem-write", "shell"] },
  ]);
  for (const task of ralphTasks) assert.deepEqual(task.requires, ["filesystem-write", "shell"]);
});

test("agent validation rejects mandatory delegation without subagent and unknown skills", async () => {
  const diagnostics = validateAgentContent({
    content: await fixture("delegation-invalid.md"),
    filePath: "delegation-invalid.md",
    skillNames: new Set(["testing"]),
  });
  assert.match(messages(diagnostics), /mandates nested delegation without the subagent tool/);
  assert.match(messages(diagnostics), /unknown skill "missing-skill"/);

  const negated = `---\nname: worker\ndescription: Worker\ntools: read\nskills: testing\n---\nDo not delegate to other subagents.`;
  assert.deepEqual(validateAgentContent({
    content: negated,
    filePath: "worker.md",
    skillNames: new Set(["testing"]),
  }), []);
});

test("classifier limitation requires documented and enabled explicit invocation", () => {
  const missing = validateClassifierDocumentation({ readme: "Skills are available.", settings: {} });
  assert.match(messages(missing), /automatic classify-only activation is disabled/);
  assert.match(messages(missing), /enableSkillCommands: true/);

  const documented = "Automatic classify-only activation is disabled. Invoke these skills with `/skill:<name>`.";
  assert.match(messages(validateClassifierDocumentation({
    readme: documented,
    settings: { enableSkillCommands: false },
  })), /enableSkillCommands: true/);
  assert.deepEqual(validateClassifierDocumentation({
    readme: documented,
    settings: { enableSkillCommands: true },
  }), []);
});

test("required skill categories cannot be empty", () => {
  const diagnostics = validateSkillCategoryCounts({
    categories: ["guides", "conventions", "formats", "standards"],
    counts: new Map([["guides", 1], ["conventions", 1], ["formats", 0], ["standards", 1]]),
  });
  assert.match(messages(diagnostics), /Required skill category "formats" is empty/);
});
