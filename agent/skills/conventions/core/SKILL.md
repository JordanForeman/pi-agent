---
name: core
description: Core coding workflow guidance
injection: always
---

- Treat ambiguous requests as engineering work in the current repository.
- Keep changes small, reversible, and tied to the user's request.
- Read and search the live code before editing. Extend existing behavior instead of creating a parallel implementation.
- Preserve the repository's conventions. Do not rely on memory when the live artifact can answer the question.
- For new behavior, establish the focused failing check first when a meaningful test path exists. Implement the smallest change that makes it pass.
- Avoid speculative refactors and unrelated cleanup.
- Investigate uncertainty instead of guessing.
- Plan non-trivial work before implementing it. Delegate only when a focused specialist reduces risk or context load.
- Validate with the repository's declared checks. Report unrelated environment failures separately.
- After the user chooses a direction, complete that scope without asking for the same approval again. `safety` still governs destructive, irreversible, and externally visible actions.
