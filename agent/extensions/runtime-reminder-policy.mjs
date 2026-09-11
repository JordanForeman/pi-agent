export function isWorkflowPhasePrompt(prompt) {
  return typeof prompt === "string" && /^\*\*Workflow "[^"]+" — Phase \d+\/\d+:/u.test(prompt);
}

export function allowGenericOrchestrationReminders(prompt) {
  return !isWorkflowPhasePrompt(prompt);
}
