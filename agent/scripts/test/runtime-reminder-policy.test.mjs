import assert from "node:assert/strict";
import test from "node:test";
import { allowGenericOrchestrationReminders, isWorkflowPhasePrompt } from "../../extensions/runtime-reminder-policy.mjs";

test("recognizes only WorkflowEngine phase messages", () => {
  assert.equal(isWorkflowPhasePrompt('**Workflow "Build" — Phase 1/6: Plan**\n\nUse the subagent tool'), true);
  assert.equal(isWorkflowPhasePrompt("Please build a workflow for me"), false);
  assert.equal(isWorkflowPhasePrompt(" ## Workflow notes"), false);
});

test("suppresses generic orchestration reminders inside workflow turns", () => {
  assert.equal(allowGenericOrchestrationReminders('**Workflow "Research" — Phase 1/1: Research**'), false);
  assert.equal(allowGenericOrchestrationReminders("Build a small API"), true);
});
