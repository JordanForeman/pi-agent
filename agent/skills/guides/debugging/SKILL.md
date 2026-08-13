---
name: debugging
description: User is debugging, investigating an error, trying to understand why something doesn't work, or reporting a bug
injection: classify
---

- Start by reproducing the issue before attempting fixes.
- Read and understand the relevant code paths before proposing changes.
- Form hypotheses and verify them systematically; avoid shotgun debugging.
- When a premise is contested or you have flip-flopped, stop editing and pin down the exact observable — which code state, input, and condition produces the wrong behavior — before changing anything.
- Prove disputed behavior empirically against the live system or a regression test rather than arguing it from reasoning; treat prior conversational framing and memory as potentially stale and re-read the source.
- Absence of a behavior is not evidence of breakage. Before calling a missing side effect a bug, confirm its trigger actually fired: check the threshold, the schedule, and whether the mechanism is enabled at all. A size-gated rotation that has not reached its threshold, an interval-triggered job idle between runs, and a disabled classifier are all working correctly — and a config entry that resolves to nothing was never costing anything to begin with.
- Reproduce the exact failure mode the error names, not a generic health check. When a message identifies a specific mode, transport, or code path, exercise that one; the adjacent path often succeeds and hides the fault.
- Auto-generated summaries of a live event are a lead, not a source. Machine transcription misattributes speakers, and a summary written during an event can list actions that were already finished by the time you read it. Cross-check names and open items against a second live source before recording them.
- A configured fallback is inert until the error classifier routes the real failure into it. When a recovery path did not fire, verify which category the actual error was assigned to — do not stop at confirming the fallback is enabled.
- An upstream outage explains the trigger, not the failure mode. If a dependency's error left your process hung instead of failing, the hang is your bug and the outage only exposed it. Reconstruct the observed duration from the retry counts and timeout constants; when the arithmetic matches the wall clock, you have found the path.
- Deleting artifacts that a running process owns is futile — it recreates them, and you learn nothing from the second attempt. Stop the process or change what generates them; repeating the cleanup is the same brute force this rule already warns against.
- Check error messages, stack traces, and logs carefully before guessing.
- Don't blame the most obvious suspect; confirm causation with evidence. A change can only be caused by something whose blast radius actually reaches it, so check the suspected cause's real scope before concluding.
- When a fix is applied, verify it resolves the original issue and doesn't introduce regressions.
- Explain the root cause, not just the fix.
