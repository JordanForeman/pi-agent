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
- Check error messages, stack traces, and logs carefully before guessing.
- Don't blame the most obvious suspect; confirm causation with evidence. A change can only be caused by something whose blast radius actually reaches it, so check the suspected cause's real scope before concluding.
- When a fix is applied, verify it resolves the original issue and doesn't introduce regressions.
- Explain the root cause, not just the fix.
