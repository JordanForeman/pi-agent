import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRalphOutput } from "../../extensions/ralph-output-summary.mjs";

test("Ralph file-only receipt preserves residual gaps and their next check", () => {
  const output = [
    "RALPH_WORKER_DONE",
    "Increment: add compact receipt evidence",
    "Changed files: agent/extensions/ralph-loop.ts",
    "Validation: npm test; exit 0; focused assertions passed; VERIFIED",
    "Artifacts: .pi/ralph/workers/receipt.md",
    "Residual gaps: runtime UI remains unverified; next cheapest check: run /ralph:start in an interactive Pi session",
    "Next priority: perform the interactive smoke check",
    "Blocker/decision needed: none",
  ].join("\n");

  const summary = summarizeRalphOutput({ output });

  assert.equal(summary.verdict, "RALPH_WORKER_DONE");
  assert.match(summary.summary, /Residual gaps: runtime UI remains unverified/);
  assert.match(summary.summary, /Next check: run \/ralph:start in an interactive Pi session/);
  assert.ok(summary.topFindings.includes("Residual gaps: runtime UI remains unverified"));
  assert.ok(summary.topFindings.includes("Next check: run /ralph:start in an interactive Pi session"));
});
