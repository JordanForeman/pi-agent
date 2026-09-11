import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractWorkflowContracts,
  validateAgentContent,
  validateBuildWorkflowConfig,
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

for (const entries of ["requiredCapability", "42", "...requirements", '"shell", requiredCapability', '"shell" + suffix', 'getCapability()', 'null', '{}', '["shell"]', '"shell",,', '`shell`']) {
  test(`workflow requirements reject nonliteral array entries: ${entries}`, () => {
    assert.match(messages(validateWorkflowSource({
      source: `{ agent: "builder", requires: [${entries}], task: "Work" }`,
      filePath: "malformed.ts",
      agentCapabilities: new Map([["builder", new Set(["shell"])]]),
      knownAgents: new Set(["builder"]),
    })), /requires.*static string literal/);
  });
}

test("workflow requirements accept empty and static literal arrays", () => {
  for (const entries of ['', '"shell"', "'shell',", '"filesystem-write", \'shell\',']) {
    assert.deepEqual(validateWorkflowSource({
      source: `{ agent: "builder", requires: [${entries}], task: "Work" }`,
      filePath: "valid.ts",
      agentCapabilities: new Map([["builder", new Set(["shell", "filesystem-write"])]]),
      knownAgents: new Set(["builder"]),
    }), []);
  }
});

function validateStaticTask(source, capabilities = ["shell"]) {
  return validateWorkflowSource({ source, filePath: "canonical.ts", agentCapabilities: new Map([["builder", new Set(capabilities)]]), knownAgents: new Set(["builder"]) });
}

for (const trivia of [" ", " /* comment */ ", " // comment\n "]) {
  test(`commented agent punctuation cannot hide invalid contracts: ${JSON.stringify(trivia)}`, () => {
    const source = `{ agent${trivia}:${trivia}"missing", requires: [42], task: "Work", ...overrides }`;
    const diagnostics = messages(validateStaticTask(source));
    assert.match(diagnostics, /unknown workflow agent "missing"/);
    assert.match(diagnostics, /requires.*static string literal/);
    assert.match(diagnostics, /metadata override/);
  });

  test(`canonical properties accept punctuation trivia: ${JSON.stringify(trivia)}`, () => {
    const text = 'agent /* hidden */: "fake", requires // hidden\\n: [42], ...overrides';
    const source = `{ agent${trivia}:${trivia}"builder"${trivia},${trivia}requires${trivia}:${trivia}[${trivia}"shell"${trivia},${trivia}]${trivia},${trivia}skill${trivia}:${trivia}[${trivia}"known-skill"${trivia},${trivia}]${trivia},${trivia}task${trivia}:${trivia}${JSON.stringify(text)}${trivia},${trivia}label${trivia}:${trivia}"Work"${trivia},${trivia}}`;
    assert.equal(extractWorkflowContracts(source).length, 1);
    const options = { source, filePath: "commented.ts", agentCapabilities: new Map([["builder", new Set(["shell"])]]), knownAgents: new Set(["builder"]) };
    assert.deepEqual(validateWorkflowSource({ ...options, skillNames: new Set(["known-skill"]) }), []);
    assert.match(messages(validateWorkflowSource({ ...options, skillNames: new Set() })), /unknown skill "known-skill"/);
  });
}

for (const entries of ["42", "...unknownSkills", '"known-skill", 42', '"known-skill" + suffix']) {
  test(`immediate skill arrays reject nonliteral entries: ${entries}`, () => {
    assert.match(messages(validateStaticTask(`{ agent: "builder", requires: [], skill: [${entries}], task: "Work" }`)), /canonical.*task|metadata override/);
  });
}

test("immediate skill arrays accept only known static literals", () => {
  for (const entries of ["", '"known-skill"', "'known-skill',", '/* trivia */ "known-skill", // trailing\n']) {
    assert.deepEqual(validateWorkflowSource({
      source: `{ agent: "builder", requires: [], skill: [${entries}], task: "Work" }`,
      filePath: "valid-skills.ts",
      agentCapabilities: new Map(),
      knownAgents: new Set(["builder"]),
      skillNames: new Set(["known-skill"]),
    }), []);
  }
});

for (const entries of ['"shell" /* rationale */', '// rationale\n "shell", // trailing\n', '/* ] agent: "fake" */ "shell"', '"shell" /* comma , */ ,']) {
  test(`literal requirements allow comment trivia: ${entries}`, () => {
    assert.deepEqual(validateStaticTask(`{ agent: "builder", requires: [${entries}], task: "Work" }`), []);
  });
}

for (const entries of ['"shell" /* rationale */ + suffix', '/* rationale */ 42', '"shell", // rationale\n ...requirements', '"shell" /* gap */ "shell"', '"shell" // hidden close ]\n + suffix']) {
  test(`comments cannot hide requirement expressions: ${entries}`, () => {
    assert.match(messages(validateStaticTask(`{ agent: "builder", requires: [${entries}], task: "Work" }`)), /requires.*static string literal/);
  });
}

test("comment markers inside capability strings are not trivia", () => {
  for (const capability of ["shell/*rationale*/", "shell//rationale"]) {
    const source = `{ agent: "builder", requires: ["${capability}"], task: "Work" }`;
    assert.deepEqual(validateStaticTask(source, [capability]), []);
    assert.match(messages(validateStaticTask(source)), /requires capability/);
  }
});

for (const suffix of ['...{ requires: [42] }, task: "Work"', 'requires: [42], task: "Work"', 'task: "Work", ...overrides', 'task: "Work", "requires": [42]', 'task: "Work", ["requires"]: [42]', 'task: "Work", requires: []']) {
  test(`canonical tasks reject metadata overrides: ${suffix}`, () => {
    assert.match(messages(validateStaticTask(`{ agent: "builder", requires: [], ${suffix} }`)), /canonical.*task|metadata override/);
  });
}

test("canonical task text retains existing interpolated templates and joined arrays", () => {
  for (const task of ['`Ralph run: ${opts.runId}`', '[`Run: ${opts.runId}`, `Increment: ${((context.state.count as number) ?? 0) + 1}`, "Work"].join("\\n")']) {
    assert.deepEqual(validateStaticTask(`{ agent: "builder", requires: [], task: ${task} }`), []);
    assert.match(messages(validateStaticTask(`{ agent: "builder", requires: [], task: ${task}, ...overrides }`)), /metadata override/);
  }
});

test("task text is not scanned as metadata override syntax", () => {
  const text = 'agent: "fake", requires: [42], ...overrides, skill: ["fake"] // /* }';
  for (const task of [JSON.stringify(text), `[${JSON.stringify(text)}, "Work"].join("\\n")`]) {
    assert.deepEqual(validateStaticTask(`{ agent: "builder", requires: [], task: ${task} }`), []);
  }
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

test("canonical workflow tasks accept optional static model overrides", () => {
  for (const properties of [
    'model: "test-provider/core:high", task: "Work"',
    'task: "Work", model: "test-provider/core:high"',
    'skill: [], model: \'test-provider/selector\', task: "Work"',
  ]) {
    assert.deepEqual(validateStaticTask(`{ agent: "builder", requires: [], ${properties} }`), []);
  }
});

for (const model of ['""', '"  "', '42', 'null', 'selectedModel', '"test" + suffix', '"first", model: "second"']) {
  test(`canonical workflow tasks reject invalid model metadata: ${model}`, () => {
    assert.match(messages(validateStaticTask(`{ agent: "builder", requires: [], model: ${model}, task: "Work" }`)), /canonical.*task|model/);
  });
}

for (const model of ["", "  ", 42, null, false, [], {}]) {
  test(`JSON workflow tasks reject invalid model metadata: ${JSON.stringify(model)}`, () => {
    assert.match(messages(validateWorkflowTaskSpecs({
      tasks: [{ agent: "builder", requires: [], model }], filePath: "models.workflow.json",
      agentCapabilities: new Map(), knownAgents: new Set(["builder"]),
    })), /model.*non-empty string/);
  });
}

test("JSON workflow tasks accept omitted or nonempty model metadata", () => {
  assert.deepEqual(validateWorkflowTaskSpecs({
    tasks: [{ agent: "builder", requires: [] }, { agent: "builder", requires: [], model: "test-provider/core:high" }],
    filePath: "models.workflow.json", agentCapabilities: new Map(), knownAgents: new Set(["builder"]),
  }), []);
});

test("JSON workflow tasks declare valid agent capabilities", async () => {
  const specs = await Promise.all([
    readFile(new URL("../../extension-core/review.workflow.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../extensions/workflows/build.workflow.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  const tasks = specs.flatMap((spec) => {
    const phases = spec.phases ? [...spec.phases, spec.selection] : [spec.review, spec.synthesize];
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

test("build review configuration validates optional models and the selector contract", async () => {
  const spec = JSON.parse(await readFile(new URL("../../extensions/workflows/build.workflow.json", import.meta.url), "utf8"));
  for (const reviewModels of [undefined, {}, { core: "test-provider/core" }, { selector: "test-provider/selector" }]) {
    assert.deepEqual(validateBuildWorkflowConfig({ spec: { ...spec, reviewModels }, filePath: "build.workflow.json" }), []);
  }
  for (const reviewModels of [null, [], { core: "" }, { selector: 42 }, { specialist: "test-provider/model" }]) {
    assert.match(messages(validateBuildWorkflowConfig({ spec: { ...spec, reviewModels }, filePath: "build.workflow.json" })), /reviewModels/);
  }
  for (const selection of [undefined, { ...spec.selection, tasks: [] }, { ...spec.selection, tasks: [{ agent: "builder" }] }]) {
    assert.match(messages(validateBuildWorkflowConfig({ spec: { ...spec, selection }, filePath: "build.workflow.json" })), /selection/);
  }
  for (const maxFixRounds of [0, 4, 1.5]) {
    assert.match(messages(validateBuildWorkflowConfig({ spec: { ...spec, maxFixRounds }, filePath: "build.workflow.json" })), /maxFixRounds/);
  }
  assert.equal(spec.selection.tasks[0].agent, "pr-triage");
  assert.match(messages(validateWorkflowTaskSpecs({
    tasks: [{ ...spec.selection.tasks[0], skill: ["missing-skill"], requires: ["filesystem-write"] }],
    filePath: "build.workflow.json", knownAgents: new Set(["pr-triage"]),
    agentCapabilities: new Map([["pr-triage", new Set(["shell"])]]), skillNames: new Set(),
  })), /requires capability "filesystem-write"/);
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
    readFile(new URL("../../extensions/workflows/plan.ts", import.meta.url), "utf8"),
    readFile(new URL("../../extensions/workflows/research.ts", import.meta.url), "utf8"),
    readFile(new URL("../../extensions/workflows/verify.ts", import.meta.url), "utf8"),
    readFile(new URL("../../extensions/ralph-loop.ts", import.meta.url), "utf8"),
  ]);
  const [tddTasks, triageTasks, prReviewTasks, planTasks, researchTasks, verifyTasks, ralphTasks] = sources.map((source) => extractWorkflowContracts(source));

  assert.deepEqual([tddTasks.length, triageTasks.length, prReviewTasks.length, planTasks.length, researchTasks.length, verifyTasks.length, ralphTasks.length], [3, 3, 1, 1, 1, 1, 3]);
  for (const task of [...tddTasks, ...triageTasks, ...prReviewTasks, ...planTasks, ...researchTasks, ...verifyTasks, ...ralphTasks]) {
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
