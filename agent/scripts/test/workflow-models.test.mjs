import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const ASTRA_MODEL = "openai-codex/gpt-6-astra";
const SOL_MODEL = "openai-codex/gpt-5.6-sol";

// Copy contracts so model tests never configure live workflows or providers.
async function loadFixture(t, kind, model) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-workflow-model-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(new URL("../../extension-core/", import.meta.url), path.join(root, "extension-core"), { recursive: true });
  await cp(new URL("../../extensions/workflows/", import.meta.url), path.join(root, "extensions/workflows"), { recursive: true });
  const specPath = path.join(root, kind === "build" ? "extensions/workflows/build.workflow.json" : "extension-core/review.workflow.json");
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  const phases = kind === "build" ? [...spec.phases, spec.selection] : [spec.review, spec.synthesize];
  for (const phase of phases) for (const candidate of phase.tasks) delete candidate.model;
  const task = kind === "build" ? spec.phases[0].tasks[0] : spec.review.tasks[0];
  if (model !== undefined) task.model = model;
  await writeFile(specPath, JSON.stringify(spec));

  // Pi's loader supports extensionless TS imports; emulate only that resolution.
  const rootUrl = pathToFileURL(`${root}/`).href;
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.startsWith(rootUrl) && specifier.startsWith(".") && !path.extname(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    return await import(pathToFileURL(path.join(root, kind === "build" ? "extensions/workflows/build.ts" : "extension-core/review-contract.ts")).href);
  } finally {
    hook.deregister();
  }
}

test("live workflows route planning and review to Astra and implementation to Sol", async () => {
  const [build, review] = await Promise.all([
    readFile(new URL("../../extensions/workflows/build.workflow.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../extension-core/review.workflow.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

  assert.equal(build.selection.tasks[0].model, ASTRA_MODEL);
  for (const phase of build.phases) {
    const expected = ["implement", "fix"].includes(phase.id) ? SOL_MODEL : ASTRA_MODEL;
    for (const task of phase.tasks) assert.equal(task.model, expected, `${phase.id}/${task.agent}`);
  }
  for (const phase of [review.review, review.synthesize]) {
    for (const task of phase.tasks) assert.equal(task.model, ASTRA_MODEL, `${phase.id}/${task.agent}`);
  }
});

test("plan command dispatches its planner through Codex Astra", async (t) => {
  const rootUrl = new URL("../../", import.meta.url).href;
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.startsWith(rootUrl) && specifier.startsWith(".") && !path.extname(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      return nextResolve(specifier, context);
    },
  });
  const module = await import("../../extensions/workflows/plan.ts");
  hook.deregister();
  const commands = new Map();
  const handlers = new Map();
  const messages = [];
  module.default({
    registerCommand: (name, command) => commands.set(name, command),
    on: (name, handler) => handlers.set(name, handler),
    sendUserMessage: (text) => messages.push(text),
  });
  t.after(() => handlers.get("session_shutdown")?.({}, { hasUI: false }));

  await commands.get("plan").handler("Add a cache", { hasUI: false });
  const call = JSON.parse(messages[0].match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(call.agent, "planner");
  assert.equal(call.model, ASTRA_MODEL);
  assert.match(call.task, /Add a cache/);
});

for (const kind of ["build", "review"]) {
  for (const model of [undefined, "test-provider/fixture:high"]) {
    test(`${kind} template preserves ${model === undefined ? "omitted" : "explicit"} model`, async (t) => {
      const module = await loadFixture(t, kind, model);
      let tasks;
      if (kind === "review") {
        const phase = module.createSharedReviewPhase({ review_context: "Fixture objective" });
        assert.equal(phase.execution, "parallel");
        assert.equal(phase.tasks.length, 5);
        tasks = phase.tasks;
      } else {
        const commands = new Map();
        const handlers = new Map();
        const messages = [];
        module.default({ registerCommand: (name, command) => commands.set(name, command), on: (name, handler) => handlers.set(name, handler), sendUserMessage: (text) => messages.push(text) });
        const ctx = { hasUI: false };
        t.after(() => handlers.get("session_shutdown")?.({}, ctx));
        await commands.get("build").handler("Fixture objective", ctx);
        const call = JSON.parse(messages[0].match(/```json\n([\s\S]*?)\n```/)[1]);
        assert.equal(call.async, false);
        tasks = [call];
      }
      assert.equal(tasks[0].model, model);
      assert.equal(Object.hasOwn(tasks[0], "model"), model !== undefined);
      assert.ok(tasks[0].skill.length > 0);
      for (const task of tasks.slice(1)) assert.equal(Object.hasOwn(task, "model"), false);
    });
  }
  for (const model of [null, "", "  ", 42]) {
    test(`${kind} template rejects model ${JSON.stringify(model)}`, async (t) => {
      await assert.rejects(loadFixture(t, kind, model), /model must be a non-empty string/);
    });
  }
}
