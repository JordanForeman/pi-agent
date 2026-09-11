import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSubagentCompletions } from "../../extension-core/subagent-completions.mjs";
import { WorkflowEngine } from "../../extension-core/workflow-engine.ts";

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

function engineFixture(t, count = 1, transition = { type: "advance" }, execution = count > 1 ? "parallel" : "sequential") {
  const handlers = new Map();
  const messages = [];
  const notices = [];
  const ctx = { hasUI: true, ui: { notify: (text) => notices.push(text), setStatus() {} } };
  const pi = { on: (event, handler) => handlers.set(event, handler), sendUserMessage: (text) => messages.push(text) };
  const definition = { id: "test", name: "Test", phases: [
    { id: "first", label: "First", execution, tasks: Array.from({ length: count }, (_, i) => ({ agent: `worker-${i}`, requires: [], task: "Work" })), transition },
    { id: "next", label: "Next", execution: "sequential", tasks: [{ agent: "worker", requires: [], task: "Next" }], transition: { type: "advance" } },
  ] };
  const engine = new WorkflowEngine(pi, definition);
  t.after(() => engine.abort());
  engine.start("objective", ctx);
  return { engine, messages, notices, ctx,
    restart: () => engine.start("new objective", ctx),
    emit: (event, value = {}) => handlers.get(event)?.({ type: event, toolCallId: "execution", ...value }, ctx),
    result: (result, isError = false, toolCallId = "execution") => handlers.get("tool_execution_end")({ type: "tool_execution_end", toolCallId, toolName: "subagent", result, isError }, ctx),
    assertReleased() {
      const next = new WorkflowEngine({ ...pi, on() {} }, definition);
      next.start("new workflow", ctx);
      try { assert.equal(next.isActive(), true); } finally { next.abort(); }
    },
  };
}

const foreground = { agent: "builder", task: "Work", async: false };

for (const toolExecution of ["parallel", "sequential"]) {
  test(`installed Pi loop blocks all sibling dispatches (${toolExecution})`, { skip: !process.env.PI_AGENT_LOOP_MODULE }, async (t) => {
    const { runAgentLoop } = await import(process.env.PI_AGENT_LOOP_MODULE);
    const h = engineFixture(t);
    let executions = 0;
    const preflights = [];
    const message = { role: "assistant", content: [true, true, false].map((async, i) => ({ type: "toolCall", id: `sibling-${i}`, name: "subagent", arguments: { ...foreground, async } })), stopReason: "toolUse", timestamp: Date.now() };
    const messages = await runAgentLoop([], { systemPrompt: "test", messages: [], tools: [{ name: "subagent", description: "test", parameters: { type: "object", properties: {} }, execute: async () => { executions++; return result("single", [child("builder")]); } }] }, {
      model: { provider: "test" }, convertToLlm: (messages) => messages, toolExecution,
      beforeToolCall: ({ toolCall, args }) => {
        preflights.push(toolCall.id);
        return h.emit("tool_call", { toolCallId: toolCall.id, toolName: toolCall.name, input: args });
      },
      shouldStopAfterTurn: () => true,
    }, (event) => h.emit(event.type, event), undefined, async () => ({
      async *[Symbol.asyncIterator]() { yield { type: "done", message }; },
      result: async () => message,
    }));
    assert.deepEqual(preflights, ["sibling-0", "sibling-1", "sibling-2"]);
    assert.equal(executions, 0);
    assert.equal(messages.filter((m) => m.role === "toolResult" && m.isError).length, 3);
    assert.equal(h.engine.getStatus().engineState, "failed");
  });
}

for (const boundary of ["agent_end", "session_start", "session_shutdown"]) {
  test(`dispatch stop survives sibling preflights and resets at ${boundary}`, (t) => {
    const h = engineFixture(t);
    h.emit("agent_start");
    assert.equal(h.emit("tool_call", { toolCallId: "one", toolName: "subagent", input: { ...foreground, async: true } })?.block, true);
    for (const [i, input] of [{ ...foreground, async: true }, foreground, { action: "resume", id: "old", async: false }].entries()) {
      assert.equal(h.emit("tool_call", { toolCallId: `sibling-${i}`, toolName: "subagent", input })?.block, true);
    }
    assert.equal(h.emit("tool_call", { toolCallId: "status", toolName: "subagent", input: { action: "status" } }), undefined);
    h.result(result("single", []), false, "status");
    h.assertReleased();
    h.emit(boundary);
    h.restart();
    // Check the boundary reset itself, before agent_start can also clear the stop.
    assert.equal(h.emit("tool_call", { toolCallId: "new", toolName: "subagent", input: foreground }), undefined);
    h.emit("agent_start");
  });
}

test("resume is blocked even with explicit async:false", (t) => {
  const h = engineFixture(t);
  assert.equal(h.emit("tool_call", { toolCallId: "resume", toolName: "subagent", input: { action: "resume", id: "old", async: false } })?.block, true);
  assert.equal(h.engine.isActive(), false);
});

for (const type of ["conditional", "loop"]) {
  for (const count of [1, 3]) {
    test(`aborted dispatch bypasses ${type} callbacks with ${count} sequential tasks`, (t) => {
      let callbacks = 0;
      const transition = type === "conditional"
        ? { type, decide: () => { callbacks++; return "next"; } }
        : { type, until: () => { callbacks++; return false; } };
      const h = engineFixture(t, count, transition, "sequential");
      const controller = new AbortController();
      h.ctx.signal = controller.signal;
      h.emit("tool_call", { toolCallId: "cancelled", toolName: "subagent", input: foreground });
      controller.abort();
      h.result(result("single", [child("builder", { exitCode: 1 })]), true, "cancelled");
      h.emit("agent_end");
      assert.equal(callbacks, 0);
      assert.equal(h.engine.getStatus().engineState, "failed");
      assert.equal(h.engine.getStatus().context.phases.first.status, "failed");
      assert.equal(h.messages.length, 1);
      h.assertReleased();
    });
  }
  test(`noncancelled failure still evaluates ${type}`, (t) => {
    let callbacks = 0;
    const transition = type === "conditional"
      ? { type, decide: () => { callbacks++; return "next"; } }
      : { type, until: () => { callbacks++; return true; } };
    const h = engineFixture(t, 1, transition);
    h.result(result("single", [child("builder", { exitCode: 1 })]), true);
    h.emit("agent_end");
    assert.equal(callbacks, 1);
    assert.equal(h.engine.getStatus().context.currentPhase, "next");
  });
}

for (const action of ["status", "list", "doctor"]) {
  for (const isError of [false, true]) {
    test(`${action} empty-single completion is ignored by id (error=${isError})`, (t) => {
      const h = engineFixture(t);
      assert.equal(h.emit("tool_call", { toolCallId: "management", toolName: "subagent", input: { action } }), undefined);
      h.emit("tool_call", { toolCallId: "execution", toolName: "subagent", input: foreground });
      h.result(result("single", []), isError, "management");
      h.emit("agent_end");
      assert.equal(h.engine.isActive(), true);
      assert.equal(h.engine.getStatus().context.currentPhase, "first");
      h.emit("tool_call", { toolCallId: "management", toolName: "subagent", input: foreground });
      h.result(result("single", []), false, "management");
      assert.equal(h.engine.getStatus().engineState, "failed");
    });
  }
}

for (const boundary of ["agent_end", "agent_start", "session_start", "session_shutdown"]) {
  test(`uncompleted management IDs are cleared at ${boundary}`, (t) => {
    const h = engineFixture(t);
    h.emit("tool_call", { toolCallId: "stale", toolName: "subagent", input: { action: "status" } });
    h.emit(boundary);
    if (!h.engine.isActive()) h.restart();
    h.result(result("single", []), false, "stale");
    assert.equal(h.engine.getStatus().engineState, "failed");
  });
}

for (const flag of ["interrupted", "detached"]) {
  for (const count of [1, 2, 3]) {
    for (const transition of [{ type: "advance" }, { type: "conditional", decide: () => "next" }, { type: "loop", until: () => false }]) {
      test(`${flag} zero-exit child stops ${transition.type} transition (${count} tasks) and releases ownership`, (t) => {
        const h = engineFixture(t, count, transition);
        const children = [...(count > 1 ? [child("passed")] : []), child("paused", { [flag]: true })];
        h.result(result(count === 1 ? "single" : "parallel", children));
        h.emit("agent_end");
        const { engineState, context } = h.engine.getStatus();
        assert.equal(engineState, "failed");
        assert.equal(context.currentPhase, null);
        assert.equal(context.phases.first.status, "failed");
        assert.deepEqual(context.phases.first.outputs.map((o) => o.status), count > 1 ? ["success", "error"] : ["error"]);
        assert.equal(h.messages.length, 1);
        h.assertReleased();
      });
    }
  }
}

for (const flag of ["interrupted", "detached"]) {
  test(`legacy chain ${flag} child cannot advance the workflow`, (t) => {
    const h = engineFixture(t);
    h.result(result("chain", [child("paused", { [flag]: true })]));
    h.emit("agent_end");
    assert.equal(h.engine.getStatus().engineState, "failed");
    h.assertReleased();
  });
}

for (const mode of ["single", "parallel", "chain"]) {
  for (const asyncAck of [false, true]) {
    test(`${mode} ${asyncAck ? "background acknowledgement" : "cancel"} fails without advancing or locking ownership`, (t) => {
      const h = engineFixture(t, mode === "parallel" ? 3 : 1);
      const envelope = result(mode, []);
      if (asyncAck) envelope.details.asyncId = "background-1";
      h.result(envelope);
      h.emit("agent_end");
      assert.equal(h.engine.getStatus().engineState, "failed");
      assert.equal(h.messages.length, 1);
      assert.match(h.notices.join("\n"), asyncAck ? /background.*foreground/i : /cancel|no completed/i);
      h.assertReleased();
    });
  }
}

for (const count of [1, 3]) {
  test(`generated phase calls require foreground (${count} tasks)`, (t) => {
    const h = engineFixture(t, count);
    const call = JSON.parse(h.messages[0].match(/```json\n([\s\S]*?)\n```/)[1]);
    assert.equal(call.async, false);
    assert.match(h.emit("before_agent_start", { systemPrompt: "base" }).systemPrompt, /async.*false/);
  });
}

for (const async of [undefined, true]) {
  test(`non-foreground dispatch is blocked before defaults can launch it (async=${async})`, (t) => {
    const h = engineFixture(t);
    const response = h.emit("tool_call", { toolName: "subagent", input: { agent: "worker", task: "Work", async } });
    assert.equal(response?.block, true);
    assert.match(response.reason, /async.*false/);
    assert.equal(h.engine.getStatus().engineState, "failed");
    h.assertReleased();
  });
}

test("foreground dispatch succeeds; pending tasks and management do not advance", (t) => {
  const h = engineFixture(t, 2);
  assert.equal(h.emit("tool_call", { toolName: "subagent", input: { tasks: [], async: false } }), undefined);
  assert.equal(h.emit("tool_call", { toolName: "subagent", input: { action: "list" } }), undefined);
  h.result(result("management", []));
  h.result(result("single", [child("one")]));
  h.emit("agent_end");
  assert.equal(h.engine.getStatus().context.currentPhase, "first");
  h.result(result("single", [child("two")]));
  h.emit("agent_end");
  assert.equal(h.engine.getStatus().context.currentPhase, "next");
  assert.equal(h.engine.getStatus().context.phases.first.status, "completed");
  h.result(result("single", [child("last")]));
  h.emit("agent_end");
  assert.equal(h.engine.getStatus().engineState, "completed");
  h.assertReleased();
});

test("mixed completed batch with worker failure fails advance", (t) => {
  const h = engineFixture(t, 2);
  h.result(result("parallel", [child("passed"), child("failed", { exitCode: 1 })]));
  h.emit("agent_end");
  assert.equal(h.engine.getStatus().engineState, "failed");
  h.assertReleased();
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
