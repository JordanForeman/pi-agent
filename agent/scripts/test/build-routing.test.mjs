import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { WorkflowEngine } from "../../extension-core/workflow-engine.ts";

const roles = ["design-reviewer", "rails-reviewer", "frontend-reviewer", "testing-reviewer"];
const selection = (chosen = []) => JSON.stringify({ decisions: roles.map((agent) => ({ agent, applicable: chosen.includes(agent), reason: `Inspected src/service.ts and test/service.test.ts: ${agent} ${chosen.includes(agent) ? "applies" : "does not apply"}.` })) });

async function loadFixture(t, mutate = () => {}, entry = "build") {
  const root = await mkdtemp(path.join(tmpdir(), "pi-build-routing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(new URL("../../extension-core/", import.meta.url), path.join(root, "extension-core"), { recursive: true });
  await cp(new URL("../../extensions/workflows/", import.meta.url), path.join(root, "extensions/workflows"), { recursive: true });
  const specPath = path.join(root, "extensions/workflows/build.workflow.json");
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  mutate(spec);
  await writeFile(specPath, JSON.stringify(spec));
  const rootUrl = pathToFileURL(`${root}/`).href;
  const hook = registerHooks({ resolve(specifier, context, nextResolve) {
    return nextResolve(context.parentURL?.startsWith(rootUrl) && specifier.startsWith(".") && !path.extname(specifier) ? `${specifier}.ts` : specifier, context);
  } });
  try { return await import(pathToFileURL(path.join(root, `extensions/workflows/${entry}.ts`)).href); }
  finally { hook.deregister(); }
}

async function fixture(t, mutate) {
  const module = await loadFixture(t, mutate);
  const handlers = new Map(); const messages = []; const ctx = { hasUI: false };
  const pi = { on: (name, handler) => handlers.set(name, handler), sendUserMessage: (text) => messages.push(text) };
  const engine = new WorkflowEngine(pi, module.createBuildWorkflow("build"));
  t.after(() => engine.abort());
  engine.start("Implement the service", ctx);
  return { engine, messages,
    get context() { return engine.getStatus().context; },
    get phase() { return this.context.currentPhase; },
    get call() { return JSON.parse(messages.at(-1).match(/```json\n([\s\S]*?)\n```/)[1]); },
    emit: (event, data = {}) => handlers.get(event)?.(data, ctx),
    complete(text = "Inspected src/service.ts; validation passed.", options = {}) {
      const tasks = this.call.tasks ?? [this.call];
      const children = options.children ?? tasks.map((task) => ({ agent: task.agent, exitCode: options.failed ? 1 : 0, finalOutput: text }));
      this.emit("tool_execution_end", { toolCallId: "run", toolName: "subagent", isError: options.eventError ?? false, result: { isError: options.envelopeError ?? false, details: { mode: options.mode ?? (tasks.length > 1 ? "parallel" : "single"), results: children } } });
      this.emit("agent_end");
    },
    toCore() { this.complete(); this.complete(); assert.equal(this.phase, "core-review"); },
    toSelection() { this.toCore(); this.complete(); assert.equal(this.phase, "select-reviewers"); },
    toSynthesis(chosen = []) { this.toSelection(); this.complete(selection(chosen)); if (chosen.length) this.complete(); assert.equal(this.phase, "synthesize"); },
    assertBlocked() { assert.equal(this.phase, "finalize"); assert.equal(this.context.state.finalVerdict, "BUILD_BLOCKED"); assert.equal(this.context.state.fixRounds, 0); },
  };
}

for (const chosen of [[], [roles[3]], [roles[0], roles[3]]]) test(`core first, then parent selects ${chosen.length} specialists`, async (t) => {
  const h = await fixture(t); h.toCore();
  assert.equal(h.call.agent, "reviewer"); assert.ok(h.call.skill.includes("code-security"));
  h.complete(); assert.equal(h.call.agent, "pr-triage"); assert.match(h.call.task, /Do not delegate/);
  h.complete(selection(chosen));
  if (chosen.length) {
    assert.equal(h.phase, "specialist-review");
    assert.deepEqual((h.call.tasks ?? [h.call]).map((task) => task.agent), chosen);
    assert.equal(Boolean(h.call.tasks), chosen.length > 1); h.complete();
  }
  assert.equal(h.phase, "synthesize"); h.complete("Verdict: BUILD_CLEAN\nNo outstanding findings.");
  assert.equal(h.phase, "finalize"); assert.equal(h.context.state.finalVerdict, "BUILD_CLEAN");
  for (const message of h.messages) for (const match of message.matchAll(/```json\n([\s\S]*?)\n```/g)) assert.equal(JSON.parse(match[1]).async, false);
});

const invalidSelections = {
  unknown: selection().replace("design-reviewer", "security-reviewer"),
  duplicate: selection().replace("rails-reviewer", "design-reviewer"),
  duplicateProperty: selection().replace('"applicable":false', '"applicable":true,"applicable":false'),
  duplicateDecisions: `{"decisions":[],${selection().slice(1)}`,
  missing: JSON.stringify({ decisions: JSON.parse(selection()).decisions.slice(1) }),
  malformed: "not JSON", fenced: `\`\`\`json\n${selection()}\n\`\`\``, empty: "", noDecisions: "{}",
  emptyReason: selection().replace(/"reason":"[^"]+"/, '"reason":"  "'),
  nonBoolean: selection().replace('"applicable":false', '"applicable":"false"'),
  extraField: selection().replace('"applicable":false', '"extra":true,"applicable":false'),
};
for (const [name, text] of Object.entries(invalidSelections)) test(`reject ${name} selection`, async (t) => {
  const h = await fixture(t); h.toSelection(); h.complete(text); h.assertBlocked();
});
test("failed selection cannot authorize specialists or synthesis", async (t) => {
  const h = await fixture(t); h.toSelection(); h.complete(selection([roles[0]]), { failed: true }); h.assertBlocked();
});
test("selection parsing uses raw output beyond compact receipt budget", async (t) => {
  const h = await fixture(t); h.toSelection(); const value = JSON.parse(selection([roles[3]]));
  value.decisions[0].reason += " Evidence from src/service.ts.".repeat(300);
  h.complete(JSON.stringify(value)); assert.equal(h.phase, "specialist-review"); assert.equal(h.call.agent, roles[3]);
});

for (const [text, failed] of [
  ["Verdict: BUILD_CLEAN", true], ["Verdict: BUILD_FIXES_NEEDED", true], ["", false], ["No verdict", false],
  ["Verdict: BUILD_CLEANISH", false], ["Verdict: BUILD_CLEAN or BUILD_BLOCKED", false],
  ["Verdict: BUILD_CLEAN\nVerdict: BUILD_BLOCKED", false], ["Verdict: BUILD_CLEAN\nVerdict: BUILD_CLEAN", false],
]) test(`synthesis fails closed: ${JSON.stringify([text, failed])}`, async (t) => {
  const h = await fixture(t); h.toSynthesis(); h.complete(text, { failed }); h.assertBlocked();
});
for (const phase of ["plan", "implement", "core-review", "specialist-review"]) {
  for (const empty of [false, true]) test(`${phase} ${empty ? "empty" : "failed"} prerequisite blocks`, async (t) => {
    const h = await fixture(t);
    if (phase === "implement") h.complete();
    if (phase === "core-review") h.toCore();
    if (phase === "specialist-review") { h.toSelection(); h.complete(selection([roles[3]])); }
    h.complete(empty ? "" : "Verdict: BUILD_CLEAN", { failed: !empty }); h.assertBlocked();
  });
}
for (const prerequisite of ["plan", "implement", "core-review", "select-reviewers", "specialist-review"]) test(`missing current ${prerequisite} blocks synthesis`, async (t) => {
  const h = await fixture(t); h.toSynthesis([roles[3]]); delete h.context.phases[prerequisite];
  h.complete("Verdict: BUILD_FIXES_NEEDED"); h.assertBlocked();
});
test("duplicate specialist completions cannot replace a missing reviewer", async (t) => {
  const h = await fixture(t); h.toSelection(); h.complete(selection([roles[0], roles[3]]));
  h.complete("", { children: [1, 2].map(() => ({ agent: roles[0], exitCode: 0, finalOutput: "Inspected src/service.ts" })) }); h.assertBlocked();
});
test("fixes invalidate review evidence, reselect, and can finish clean", async (t) => {
  const h = await fixture(t); h.toSelection(); h.complete(selection([roles[0]])); h.complete("STALE_DESIGN_FINDING");
  h.complete("Verdict: BUILD_FIXES_NEEDED\nOLD_SYNTHESIS_MARKER"); assert.equal(h.phase, "fix");
  h.complete("FIX_EVIDENCE: node test/service.test.ts passed"); assert.equal(h.phase, "core-review");
  for (const id of ["core-review", "select-reviewers", "specialist-review", "synthesize", "fix"]) assert.equal(h.context.phases[id], undefined);
  assert.equal(h.context.state.finalVerdict, null); assert.equal(h.context.state.selection, undefined);
  assert.equal(h.context.state.fixEvidence.length, 1);
  h.complete("Fresh core findings"); h.complete(selection()); assert.equal(h.phase, "synthesize");
  assert.doesNotMatch(h.call.task.split("Review findings:")[1], /STALE_DESIGN_FINDING|OLD_SYNTHESIS_MARKER|BUILD_FIXES_NEEDED/); assert.match(h.call.task, /FIX_EVIDENCE/);
  h.complete("Verdict: BUILD_CLEAN"); assert.equal(h.context.state.finalVerdict, "BUILD_CLEAN"); assert.equal(h.context.state.fixRounds, 1);
});
test("exactly three fix rounds, then honest unresolved finalization", async (t) => {
  const h = await fixture(t); h.toSynthesis();
  for (let round = 1; round <= 3; round++) {
    h.complete("Verdict: BUILD_FIXES_NEEDED\nFix src/service.ts"); assert.equal(h.phase, "fix"); assert.equal(h.context.state.fixRounds, round);
    h.complete(); assert.equal(h.phase, "core-review"); h.complete(); h.complete(selection()); assert.equal(h.phase, "synthesize");
  }
  h.complete("Verdict: BUILD_FIXES_NEEDED\nStill unresolved"); assert.equal(h.phase, "finalize");
  assert.equal(h.context.state.finalVerdict, "BUILD_FIXES_NEEDED"); assert.equal(h.context.state.fixRounds, 3);
});
test("specialists can be selected for the first time after a fix", async (t) => {
  const h = await fixture(t); h.toSynthesis(); h.complete("Verdict: BUILD_FIXES_NEEDED"); h.complete();
  h.complete(); h.complete(selection([roles[0], roles[3]])); assert.equal(h.phase, "specialist-review");
  h.complete(); assert.equal(h.phase, "synthesize"); h.complete("Verdict: BUILD_CLEAN");
  assert.equal(h.context.state.finalVerdict, "BUILD_CLEAN");
});
test("failed reselection cannot use previous successful review evidence", async (t) => {
  const h = await fixture(t); h.toSynthesis([roles[0]]); h.complete("Verdict: BUILD_FIXES_NEEDED"); h.complete();
  h.complete(); h.complete(selection(), { failed: true });
  assert.equal(h.phase, "finalize"); assert.equal(h.context.state.finalVerdict, "BUILD_BLOCKED");
  assert.equal(h.context.state.fixRounds, 1); assert.equal(h.context.phases.synthesize, undefined);
});
test("failed fix cannot restart review or claim clean", async (t) => {
  const h = await fixture(t); h.toSynthesis(); h.complete("Verdict: BUILD_FIXES_NEEDED"); h.complete("Fix failed", { failed: true });
  assert.equal(h.phase, "finalize"); assert.equal(h.context.state.finalVerdict, "BUILD_BLOCKED");
});
for (const reviewModels of [undefined, { core: "test-provider/core", selector: "test-provider/selector" }, { core: "test-provider/core" }, { selector: "test-provider/selector" }]) test(`build-local model routing: ${JSON.stringify(reviewModels)}`, async (t) => {
  const h = await fixture(t, (spec) => { if (reviewModels) spec.reviewModels = reviewModels; });
  h.toCore(); assert.equal(h.call.model, reviewModels?.core); assert.equal(Object.hasOwn(h.call, "model"), reviewModels?.core !== undefined);
  h.complete(); assert.equal(h.call.model, reviewModels?.selector); assert.equal(Object.hasOwn(h.call, "model"), reviewModels?.selector !== undefined);
  h.complete(selection([roles[0], roles[3]])); for (const task of h.call.tasks) assert.equal(Object.hasOwn(task, "model"), false);
});
for (const value of [null, [], { core: "" }, { selector: 42 }, { specialist: "test-provider/model" }]) test(`invalid build reviewModels rejected: ${JSON.stringify(value)}`, async (t) => {
  await assert.rejects(loadFixture(t, (spec) => { spec.reviewModels = value; }), /reviewModels/);
});
test("standalone review retains fixed five reviewers and foreground dispatch", async (t) => {
  const module = await loadFixture(t, (spec) => { spec.reviewModels = { core: "test-provider/core", selector: "test-provider/selector" }; }, "pr-review");
  const commands = new Map(); const handlers = new Map(); const messages = []; const ctx = { hasUI: false };
  module.default({ registerCommand: (name, command) => commands.set(name, command), on: (name, handler) => handlers.set(name, handler), sendUserMessage: (text) => messages.push(text) });
  t.after(() => handlers.get("session_shutdown")?.({}, ctx)); await commands.get("review").handler("Review", ctx);
  handlers.get("tool_execution_end")({ toolName: "subagent", result: { details: { mode: "single", results: [{ agent: "pr-triage", exitCode: 0, finalOutput: "No specialists apply" }] } }, isError: false }, ctx);
  handlers.get("agent_end")({}, ctx);
  const call = JSON.parse(messages.at(-1).match(/```json\n([\s\S]*?)\n```/)[1]); assert.equal(call.async, false);
  assert.deepEqual(call.tasks.map((task) => task.agent), [...roles, "reviewer"]);
  for (const task of call.tasks) assert.equal(Object.hasOwn(task, "model"), false);
  handlers.get("tool_execution_end")({ toolName: "subagent", result: { details: { mode: "parallel", results: call.tasks.map((task) => ({ agent: task.agent, exitCode: 0, finalOutput: `Finding from ${task.agent}` })) } }, isError: false }, ctx);
  handlers.get("agent_end")({}, ctx);
  const synthesis = JSON.parse(messages.at(-1).match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(synthesis.agent, "reviewer"); assert.equal(synthesis.async, false);
  for (const task of call.tasks) assert.ok(synthesis.task.includes(`Finding from ${task.agent}`));
  const count = messages.length;
  handlers.get("tool_execution_end")({ toolName: "subagent", result: { content: [{ type: "text", text: "Review complete" }] }, isError: false }, ctx);
  handlers.get("agent_end")({}, ctx); assert.equal(messages.length, count);
});
for (const errorSource of ["eventError", "envelopeError"]) {
  for (const verdict of ["BUILD_CLEAN", "BUILD_FIXES_NEEDED"]) test(`${errorSource} zero-exit synthesis cannot authorize ${verdict}`, async (t) => {
    const h = await fixture(t); h.toSynthesis();
    h.complete(`Verdict: ${verdict}`, { [errorSource]: true }); h.assertBlocked();
  });
}
for (const mode of ["single", "parallel"]) test(`extra ${mode} synthesis child cannot hide trailing blocked failure`, async (t) => {
  const h = await fixture(t); h.toSynthesis();
  h.complete("", { mode, children: [
    { agent: "reviewer", exitCode: 0, finalOutput: "Verdict: BUILD_CLEAN" },
    { agent: "reviewer", exitCode: 1, finalOutput: "Verdict: BUILD_BLOCKED" },
  ] });
  assert.equal(h.engine.getStatus().engineState, "failed");
  assert.equal(h.context.state.finalVerdict, null); assert.equal(h.context.state.fixRounds, 0);
  assert.equal(h.context.phases.synthesize.outputs.length, 2);
});
test("extra parallel specialist child stops before synthesis", async (t) => {
  const h = await fixture(t); h.toSelection(); h.complete(selection([roles[0], roles[3]]));
  h.complete("", { children: [roles[0], roles[3], "extra"].map((agent, index) => ({ agent, exitCode: index === 2 ? 1 : 0, finalOutput: index === 2 ? "Blocked" : "Clean" })) });
  assert.equal(h.engine.getStatus().engineState, "failed");
  assert.equal(h.context.phases.synthesize, undefined); assert.equal(h.context.state.fixRounds, 0);
  assert.equal(h.context.phases["specialist-review"].outputs.length, 3);
});
for (const phase of ["plan", "implement", "core-review", "specialist-review"]) test(`${phase} metadata-only prerequisite cannot authorize work`, async (t) => {
  const h = await fixture(t);
  if (phase === "implement") h.complete();
  if (phase === "core-review") h.toCore();
  if (phase === "specialist-review") { h.toSelection(); h.complete(selection([roles[3]])); }
  h.complete("", { children: [{ agent: h.call.agent, exitCode: 0 }] }); h.assertBlocked();
});
for (const field of ["text", "content", "blocks"]) test(`legacy ${field} output still authorizes a valid plan`, async (t) => {
  const h = await fixture(t);
  const output = field === "blocks" ? { content: [{ type: "text", text: "Approved plan" }] } : { [field]: "Approved plan" };
  h.complete("", { children: [{ agent: "planner", exitCode: 0, ...output }] });
  assert.equal(h.phase, "implement");
});
for (const oversized of ["core", "selection", "specialists", "all"]) test(`complete oversized ${oversized} evidence reaches synthesis and fix authorization`, async (t) => {
  const h = await fixture(t); h.toCore();
  const evidence = (name) => `${name}_START\n${"Evidence src/service.ts\n".repeat(oversized === name || oversized === "all" ? 700 : 1)}${name}_END`;
  const core = evidence("core"); h.complete(core);
  const value = JSON.parse(selection([roles[0], roles[3]])); value.decisions[0].reason += evidence("selection");
  const selector = JSON.stringify(value); h.complete(selector);
  const specialists = [roles[0], roles[3]].map((agent) => ({ agent, exitCode: 0, finalOutput: `${agent}: ${evidence("specialists")}\nCritical blocker in ${agent}` }));
  h.complete("", { children: specialists }); assert.equal(h.phase, "synthesize");
  const required = [core, selector, ...specialists.map((child) => child.finalOutput)];
  const assertDelivered = () => {
    const instructions = h.emit("before_agent_start", { systemPrompt: "base" }).systemPrompt;
    for (const text of required) {
      assert.ok(h.call.task.includes(text), `complete evidence missing from ${h.phase} task: ${text.slice(0, 40)}`);
      assert.ok(instructions.includes(text), `complete evidence missing from ${h.phase} instructions`);
    }
    assert.doesNotMatch(h.call.task, /\[truncated \d+ chars\]/);
  };
  assertDelivered();
  const synthesis = `Verdict: BUILD_FIXES_NEEDED\n${"Accepted fix in src/service.ts\n".repeat(700)}Only accepted fixes; no optional cleanup.`;
  h.complete(synthesis); assert.equal(h.phase, "fix"); required.push(synthesis); assertDelivered();
});
test("evidence handoff preserves literal replacement syntax", async (t) => {
  const h = await fixture(t); h.toCore();
  const evidence = "Inspect replacement literals $& $$ $` $' and {phase:plan} {context} {input}.";
  h.complete(evidence); h.complete(selection());
  assert.equal(h.phase, "synthesize"); assert.ok(h.call.task.includes(evidence));
});

test("cancelled selection stops without synthesis or mutation", async (t) => {
  const h = await fixture(t); h.toSelection(); h.complete("", { children: [] });
  assert.equal(h.engine.getStatus().engineState, "failed"); assert.equal(h.context.state.fixRounds, 0); assert.equal(h.context.state.finalVerdict, null);
});
