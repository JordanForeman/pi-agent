import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSubagentCompletions } from "../../extension-core/subagent-completions.mjs";

const child = (agent, overrides = {}) => ({
  agent,
  exitCode: 0,
  finalOutput: `Verdict: ${agent} completed\n- Finding from ${agent}`,
  artifactPaths: { outputPath: `/tmp/${agent}_output.md` },
  ...overrides,
});
const result = (mode, results) => ({
  content: [{ type: "text", text: "Batch summary, not a child's final output" }],
  details: { mode, results },
});

test("management results never consume phase work, even on error", () => {
  for (const isError of [false, true]) {
    assert.deepEqual(normalizeSubagentCompletions(result("management", []), isError), []);
    assert.deepEqual(normalizeSubagentCompletions(result("management", [child("listed-agent")]), isError), []);
  }
});

test("single result preserves agent, final output, status and child artifact context", () => {
  const entry = child("pr-triage");
  assert.deepEqual(normalizeSubagentCompletions(result("single", [entry]), false), [{
    agent: entry.agent,
    rawOutput: entry.finalOutput,
    status: "success",
    toolResult: entry,
  }]);
});

test("one parallel tool result yields five independent completions, not one batch", () => {
  const entries = ["design-reviewer", "rails-reviewer", "frontend-reviewer", "testing-reviewer", "security-reviewer"].map((agent) => child(agent));
  const completions = normalizeSubagentCompletions(result("parallel", entries), false);
  assert.equal(completions.length, 5);
  completions.forEach((completion, index) => {
    assert.deepEqual(completion, {
      agent: entries[index].agent,
      rawOutput: entries[index].finalOutput,
      status: "success",
      toolResult: entries[index],
    });
    assert.strictEqual(completion.toolResult, entries[index]);
  });
});

test("parallel status uses each child's exit/error rather than the batch status", () => {
  const entries = [
    child("passed"),
    child("nonzero", { exitCode: 2 }),
    child("error", { error: "worker failed" }),
    child("flagged", { isError: true }),
  ];
  for (const batchError of [false, true]) {
    assert.deepEqual(normalizeSubagentCompletions(result("parallel", entries), batchError).map((entry) => entry.status), ["success", "error", "error", "error"]);
  }
});

test("single mode contributes at most one completion", () => {
  assert.equal(normalizeSubagentCompletions(result("single", [child("first"), child("extra")]), false).length, 1);
});

test("single child failure overrides a successful tool envelope", () => {
  const entry = child("failed", { exitCode: 1, finalOutput: "" });
  const [completion] = normalizeSubagentCompletions(result("single", [entry]), false);
  assert.equal(completion.status, "error");
  assert.equal(completion.rawOutput, "");
});

test("empty successful structured result lists (including async acknowledgements) are not completions", () => {
  assert.deepEqual(normalizeSubagentCompletions(result("single", []), false), []);
  assert.deepEqual(normalizeSubagentCompletions(result("parallel", []), false, 5), []);
  assert.deepEqual(normalizeSubagentCompletions({ details: { mode: "parallel" } }, false, 5), []);
});

test("empty single error result yields one synthetic error completion", () => {
  const envelope = result("single", []);
  assert.deepEqual(normalizeSubagentCompletions(envelope, true, 4), [{
    agent: null,
    rawOutput: "Batch summary, not a child's final output",
    status: "error",
    toolResult: envelope,
  }]);
});

test("empty parallel error result covers every remaining phase task", () => {
  const envelope = result("parallel", []);
  const completions = normalizeSubagentCompletions(envelope, true, 4);

  assert.equal(completions.length, 4);
  for (const completion of completions) {
    assert.equal(completion.status, "error");
    assert.strictEqual(completion.toolResult, envelope);
  }
});

test("nested envelope errors synthesize completions when the event fallback is false", () => {
  for (const [mode, expected] of [["single", 1], ["parallel", 3]]) {
    const envelope = { ...result(mode, []), isError: true };
    const completions = normalizeSubagentCompletions(envelope, false, 3);

    assert.equal(completions.length, expected, mode);
    assert.ok(completions.every((entry) => entry.status === "error"), mode);
    assert.ok(completions.every((entry) => entry.toolResult === envelope), mode);
  }

  const management = { ...result("management", []), isError: true };
  assert.deepEqual(normalizeSubagentCompletions(management, false, 3), []);
});

test("legacy sequential results keep text extraction, agent fallback and tool error status", () => {
  const legacy = { agent: "builder", content: [{ type: "text", text: "first" }, { type: "image" }, { type: "text", text: "second" }], outputPath: "/tmp/legacy.md" };
  assert.deepEqual(normalizeSubagentCompletions(legacy, true), [{ agent: "builder", rawOutput: "first\nsecond", status: "error", toolResult: legacy }]);
  assert.deepEqual(normalizeSubagentCompletions("plain output", false), [{ agent: null, rawOutput: "plain output", status: "success", toolResult: "plain output" }]);
  const chain = result("chain", [child("scout"), child("builder")]);
  assert.equal(normalizeSubagentCompletions(chain, false).length, 1);
});
