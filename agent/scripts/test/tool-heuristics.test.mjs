import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("strict tool heuristic lint accepts chains and intentional read-only planner", async () => {
  const script = new URL("../../subagents/scripts/lint-tool-heuristics.mjs", import.meta.url);
  const { stdout, stderr } = await execFileAsync(process.execPath, [script.pathname, "--strict"]);
  assert.equal(stderr, "");
  assert.match(stdout, /No heuristic tool-profile issues detected/);
});
