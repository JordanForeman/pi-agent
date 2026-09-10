/**
 * Normalize tool results into phase work, keeping result context for receipts.
 * @param {unknown} result
 * @param {boolean} isError
 * @param {number} [remainingTaskCount=1]
 * @returns {Array<{agent: string | null, rawOutput: string, status: "success" | "error", toolResult: unknown}>}
 */
export function normalizeSubagentCompletions(result, isError, remainingTaskCount = 1) {
  const resultObject = result && typeof result === "object" ? result : undefined;
  const details = resultObject?.details;
  const envelopeError = isError || resultObject?.isError === true;
  if (details?.mode === "management") return [];

  if (details?.mode === "single" || details?.mode === "parallel") {
    if (Array.isArray(details.results)) {
      if (details.results.length === 0) {
        // Successful empties are async acknowledgements; failed empties are terminal dispatch failures.
        if (!envelopeError) return [];
        const count = details.mode === "single" ? 1 : normalizedCount(remainingTaskCount);
        return Array.from({ length: count }, () => completion(result, true));
      }
      const children = details.mode === "single" ? details.results.slice(0, 1) : details.results;
      return children.map((child) => completion(child, envelopeError));
    }
    if (details.mode === "parallel") return [];
  }

  // Retain legacy text/envelope behavior for sequential callers and chain results.
  return [completion(result, envelopeError)];
}

function normalizedCount(value) {
  return Number.isSafeInteger(value) ? Math.max(0, value) : 1;
}

function completion(result, fallbackError) {
  const entry = result && typeof result === "object" ? result : {};
  const failed = entry.error || entry.isError === true
    || (typeof entry.exitCode === "number" ? entry.exitCode !== 0 : fallbackError);
  return {
    agent: typeof entry.agent === "string" ? entry.agent : null,
    rawOutput: extractResultText(result),
    status: failed ? "error" : "success",
    toolResult: result,
  };
}

function extractResultText(result) {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    if (typeof result.finalOutput === "string") return result.finalOutput;
    if (typeof result.text === "string") return result.text;
    if (typeof result.content === "string") return result.content;
    if (Array.isArray(result.content)) {
      return result.content
        .filter((item) => item && typeof item === "object" && item.type === "text")
        .map((item) => item.text)
        .join("\n");
    }
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }
  return String(result ?? "");
}
