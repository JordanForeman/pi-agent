import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (relative) => readFile(new URL(relative, root), "utf8");

const MODES = ["research-mode", "build-mode", "verify-mode", "review-mode", "ship-mode"];

test("interaction modes are explicit, hidden from automatic model invocation, and bounded", async () => {
  for (const mode of MODES) {
    const content = await read(`skills/guides/${mode}/SKILL.md`);
    assert.match(content, new RegExp(`^name: ${mode}$`, "m"));
    assert.match(content, /^injection: explicit$/m);
    assert.match(content, /^disable-model-invocation: true$/m);
    assert.match(content, /objective|request|command/i);
    assert.match(content, /stop|pause|not authorized/i);
  }
});

test("research and verify workflows inject complete mode skill arrays", async () => {
  const [research, verify] = await Promise.all([
    read("extensions/workflows/research.ts"),
    read("extensions/workflows/verify.ts"),
  ]);
  assert.match(research, /agent: "code-explorer",\s*requires: \["shell"\],\s*skill: \["read-only", "code-references", "research-mode", "evidence-report"\]/);
  assert.match(verify, /agent: "code-explorer",\s*requires: \["shell"\],\s*skill: \["read-only", "code-references", "validation-discovery", "verify-mode", "evidence-report"\]/);
  assert.match(research, /registerCommand\("research"/);
  assert.match(verify, /registerCommand\("verify"/);
});

test("build and shared review specs inject their modes without dropping existing skills", async () => {
  const [build, review] = await Promise.all([
    read("extensions/workflows/build.workflow.json").then(JSON.parse),
    read("extension-core/review.workflow.json").then(JSON.parse),
  ]);
  for (const phase of build.phases.filter((phase) => ["plan", "implement", "fix"].includes(phase.id))) {
    assert.ok(phase.tasks[0].skill.includes("build-mode"), `${phase.id} must include build-mode`);
    assert.ok(phase.tasks[0].skill.length > 1, `${phase.id} must retain existing skills`);
  }
  for (const phase of [review.review, review.synthesize]) {
    for (const task of phase.tasks) assert.ok(task.skill.includes("review-mode"));
  }
});

test("ship prompts are self-contained scoped approvals without fake hidden-skill injection", async () => {
  for (const prompt of ["prompts/ship/quick-commit.md", "prompts/ship/quick-pr.md"]) {
    const content = await read(prompt);
    assert.match(content, /\/quick-(?:commit|pr).*invocation authorizes/i);
    assert.match(content, /protected or shared branch/);
    assert.match(content, /authorization expires/);
    assert.doesNotMatch(content, /load and follow|ask for confirmation|confirmation before any network-visible action/i);
  }

  const shipMode = await read("skills/guides/ship-mode/SKILL.md");
  assert.match(shipMode, /Direct `\/skill:ship-mode <exact commit or PR objective>` invocation grants/);
});

test("the mandatory quality-review gate routes its reviewer to Codex Astra", async () => {
  const content = await read("extensions/discipline-gate.ts");
  assert.match(content, /subagent\(\{ agent: "reviewer", model: "openai-codex\/gpt-6-astra", task:/);
});

test("verify prompt fallback is self-contained while the workflow remains authoritative", async () => {
  const content = await read("prompts/ship/verify.md");
  assert.match(content, /target source and shared state read-only/);
  assert.match(content, /only through `scratch_workspace`/);
  assert.match(content, /Stop if verification requires target mutation/);
  assert.match(content, /deterministically injected command takes precedence/);
  assert.doesNotMatch(content, /under the bounded `verify-mode` envelope/);
});
