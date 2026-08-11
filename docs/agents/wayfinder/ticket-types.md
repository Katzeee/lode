# Ticket Types

Every ticket has exactly one Type, persisted by the issue tracker. Each `##` heading is its lowercase kebab-case identifier. Type definitions own interaction and resolution behavior; the tracker only stores the identifier.

**HITL** means human in the loop: the ticket is worked with a human who speaks for themselves. The agent never stands in for the human's side. **AFK** means the agent drives the ticket alone.

## research

- **Interaction:** AFK
- **Use when:** Knowledge outside the current working directory is required to surface a fact that a decision awaits.
- **Resolve:** Use a `/research` subagent. Record the findings and their sources as the answer.
- **After creation:** Start newly-created research tickets in parallel, capturing each subagent's findings on a throwaway `research/<name>` branch with a context pointer from the ticket. Research tickets are the exception to the one-ticket-per-session limit.

## spike

- **Interaction:** HITL
- **Use when:** A concrete decision needs a temporary artifact to make evidence observable.
- **Resolve:** Confirm the spike goal with the human if needed, run the spike, and record its evidence, artifact, and resulting decision as the answer.

## grilling

- **Interaction:** HITL
- **Use when:** A decision needs focused conversation. This is the default type.
- **Resolve:** Use `/grilling` and `/domain-modeling`, one question at a time. Resolve only through the live exchange.

## task

- **Interaction:** AFK when the agent can do the work alone; otherwise HITL.
- **Use when:** Manual work must happen before a decision can be made, with nothing yet to decide, spike, or research. It unblocks a decision rather than delivering the destination.
- **Resolve:** Do the work where possible; otherwise give the human a precise checklist. Record what was done and any resulting facts that later tickets depend on.
