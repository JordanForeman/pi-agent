export function extractRalphSignal(text) {
  const lineSignal = text.match(/(?:^|\n)\s*(RALPH_GROOMED|RALPH_WORKER_DONE|RALPH_COMPLETE|RALPH_BLOCKED|RALPH_SUMMARY_READY)\s*(?:\n|$)/);
  if (lineSignal) return lineSignal[1];

  for (const signal of ["RALPH_BLOCKED", "RALPH_COMPLETE", "RALPH_WORKER_DONE", "RALPH_GROOMED", "RALPH_SUMMARY_READY"]) {
    if (text.includes(signal)) return signal;
  }
  return null;
}

function extractSectionLine(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`(?:^|\\n)\\s*${escaped}:\\s*(.+)`));
  return match?.[1]?.trim() ?? null;
}

function extractResidualEvidence(output) {
  const residualLine = extractSectionLine(output, "Residual gaps");
  const explicitNextCheck = extractSectionLine(output, "Next check");
  const embeddedMatch = residualLine?.match(/(?:^|[.;]\s*)next(?: cheapest)? check\s*:\s*(.+)$/i);
  const embeddedNextCheck = embeddedMatch?.[1]?.trim() ?? null;
  const residualGaps = embeddedMatch?.index === undefined
    ? residualLine
    : residualLine?.slice(0, embeddedMatch.index).trim().replace(/[.;]$/, "") || null;
  return { residualGaps, nextCheck: explicitNextCheck ?? embeddedNextCheck };
}

function compactRalphSummary(output) {
  const signal = extractRalphSignal(output);
  const { residualGaps, nextCheck } = extractResidualEvidence(output);
  const fields = [
    ["Increment", extractSectionLine(output, "Increment")],
    ["Changed files", extractSectionLine(output, "Changed files")],
    ["Validation", extractSectionLine(output, "Validation")],
    ["Artifacts", extractSectionLine(output, "Artifacts")],
    ["Residual gaps", residualGaps],
    ["Next check", nextCheck],
    ["Next priority", extractSectionLine(output, "Next priority")],
    ["Blocker/decision needed", extractSectionLine(output, "Blocker/decision needed")],
  ];
  const lines = [
    signal,
    ...fields.map(([label, value]) => value ? `${label}: ${value}` : null),
  ].filter(Boolean);

  if (lines.length > 0) return lines.join("\n");
  return output.trim().split("\n").filter(Boolean).slice(0, 12).join("\n");
}

export function summarizeRalphOutput({ output }) {
  const verdict = extractRalphSignal(output) ?? undefined;
  const artifactPath = output.match(/(?:Artifacts?|Output saved to):\s*(.+?)(?:\s*\(|\n|$)/i)?.[1]?.trim();
  const { residualGaps, nextCheck } = extractResidualEvidence(output);
  const topFindings = [
    extractSectionLine(output, "Validation"),
    residualGaps ? `Residual gaps: ${residualGaps}` : null,
    nextCheck ? `Next check: ${nextCheck}` : null,
    extractSectionLine(output, "Next priority"),
    extractSectionLine(output, "Blocker/decision needed"),
  ].filter(Boolean);

  return {
    verdict,
    summary: compactRalphSummary(output),
    topFindings,
    artifactPath,
  };
}
