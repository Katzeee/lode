import { graphActionBody } from "../../../domain/fact/index.js";
import { nextHistoryLineage } from "../../../domain/history/index.js";
import type { AcceptedEditCommand } from "../application/input-validation.js";
import { prepareEdits } from "../edit-planning/index.js";
import type { BoundWorkspaceCommand } from "./command-rule.js";

export function bindEditCommand(command: AcceptedEditCommand): BoundWorkspaceCommand {
  return {
    factReadPlan: { kind: "all" },
    plan({ workspaceId, snapshot, generation, replicaId }) {
      const writes = prepareEdits(
        workspaceId,
        command.actorId,
        command.actions,
        generation,
        command.intent,
        snapshot,
        replicaId,
      );
      return {
        writes: writes.map((write) => graphActionBody(command.actorId, command.intent, write)),
        lineage: nextHistoryLineage(snapshot, command.historyChannelId, "normal", null),
      };
    },
  };
}
