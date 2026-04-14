# Harness Feedback

I mostly agree. The core direction matches the repo's adapter boundary: product identity, context assembly, policy, and continuation lifecycle should stay above the harness, while the adapter stays a thin translation seam.

What I'd modify:

- Replace **"Tool Registry"** as a mandatory harness core with **tool-call contract / tool mediation**. In this codebase, tool choice belongs upstream per turn; a harness may need a tool schema and invocation loop, but it should not own a global registry.
- Call out **continuation** more explicitly. The harness may emit resumable outcomes, but continuation persistence, resume, and follow-up delivery should remain outside the adapter and outside the bounded turn.
- Expand the **capability manifest** beyond simple yes/no flags. It should express partial or conditional support: streaming mode, tool-call limits, supported continuation outcomes, approval/deferred support, sandbox behavior, and turn/runtime limits.
- Add **versioning and observability** to the contract. `ExecutionRequest`, `ExecutionResult`, and capabilities should carry schema versions, correlation/trace IDs, and cancellation/timeout semantics.

What I'd add:

- A v1 proof rule similar to the repo's current direction: route the first-party harness through the adapter first, and assert parity for completion, tool use, clarification, approval, and one truthful unsupported/degraded case.

What I'd remove or de-emphasize:

- The framework comparison table is fine, but it is secondary. The contract and ownership rules are the real substance; the named inspirations should not drive the design.

Overall: yes, with the changes above. The strongest sentence in the doc is "separate product identity from execution"; I would make that the governing rule for every section.
