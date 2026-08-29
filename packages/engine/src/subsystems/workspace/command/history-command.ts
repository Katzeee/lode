import { graphActionBody } from "../../../domain/fact/index.js";
import { nextHistoryLineage, validateHistorySelection } from "../../../domain/history/index.js";
import type { AcceptedHistoryCommand } from "../application/input-validation.js";
import { rejectedResult } from "../workspace-results.js";
import type { BoundWorkspaceCommand } from "./command-rule.js";

export function bindHistoryCommand(command: AcceptedHistoryCommand): BoundWorkspaceCommand {
  const selection = command.selection;
  return {
    factReadPlan: { kind: "all" },
    plan({ snapshot, generation }) {
      const validation = validateHistorySelection(command.kind, selection, snapshot, generation);
      if (validation.kind !== "ready") {
        return rejectedResult(
          validation.kind === "stale" ? "stale-selection" : "history-unavailable",
          validation.reason,
          generation.identity.generationId,
        );
      }
      return {
        writes: validation.writes.map((batch) => graphActionBody(command.actorId, batch.intent, batch.actions)),
        lineage: nextHistoryLineage(snapshot, selection.channelId, command.kind, validation.targetStepId),
      };
    },
  };
}
