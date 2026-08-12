import type { EngineCommand, RejectedResult } from "../../application/contract.js";
import type { AuthorityReceipt, FactBody, FactSnapshot } from "../../domain/fact/index.js";
import type { ProjectionGeneration } from "../../domain/reconcile/index.js";
import type { FactStore } from "../authority/fact-store.js";
import { hardDeletePreview, sameHardDeleteSelection } from "./hard-delete.js";
import { rejectedResult } from "./workspace-results.js";

type MaintenancePlan =
  Readonly<{ bodies: readonly FactBody[]; lineage: AuthorityReceipt["lineage"] }> | RejectedResult;
type MaintenanceCommand = Extract<
  EngineCommand,
  { kind: "acknowledge-deletion" | "retire-replica" | "hard-delete" }
>;

export function isMaintenanceCommand(command: EngineCommand): command is MaintenanceCommand {
  return ["acknowledge-deletion", "retire-replica", "hard-delete"].includes(command.kind);
}

export function planMaintenanceCommand(
  workspaceId: string,
  command: MaintenanceCommand,
  snapshot: FactSnapshot,
  generation: ProjectionGeneration,
  facts: FactStore,
): MaintenancePlan {
  if (command.kind === "acknowledge-deletion") {
    const preview = hardDeletePreview(
      workspaceId,
      command.nodeId,
      snapshot,
      facts,
      generation.identity.generationId,
    );
    if (
      preview.selection.deletionFactIds.length === 0 ||
      JSON.stringify(command.deletionFactIds) !== JSON.stringify(preview.selection.deletionFactIds)
    ) {
      return blocked("Deletion acknowledgement does not match the current tombstone", generation);
    }
    return {
      bodies: [
        {
          kind: "maintenance",
          actorId: command.actorId,
          action: {
            kind: "deletion-acknowledge",
            nodeId: command.nodeId,
            deletionFactIds: command.deletionFactIds,
          },
        },
      ],
      lineage: null,
    };
  }
  if (command.kind === "retire-replica") {
    return command.replicaId === facts.replicaId ||
      !Object.hasOwn(snapshot.frontier, command.replicaId)
      ? blocked("Only another known Replica can be retired", generation)
      : {
          bodies: [
            {
              kind: "maintenance",
              actorId: command.actorId,
              action: { kind: "replica-retire", replicaId: command.replicaId },
            },
          ],
          lineage: null,
        };
  }
  if (command.kind !== "hard-delete") {
    throw new Error("Unknown Maintenance command");
  }
  const preview = hardDeletePreview(
    workspaceId,
    command.selection.nodeId,
    snapshot,
    facts,
    generation.identity.generationId,
  );
  if (!preview.canExecute || !sameHardDeleteSelection(command.selection, preview.selection)) {
    return blocked(
      `Hard Delete is blocked or stale: ${preview.blockers.join(", ") || "selection changed"}`,
      generation,
    );
  }
  return {
    bodies: [
      {
        kind: "maintenance",
        actorId: command.actorId,
        action: {
          kind: "node-purge",
          nodeId: command.selection.nodeId,
          deletionFactIds: command.selection.deletionFactIds,
          acknowledgementFactIds: command.selection.acknowledgementFactIds,
          retiredReplicaIds: command.selection.retiredReplicaIds,
        },
      },
    ],
    lineage: null,
  };
}

function blocked(message: string, generation: ProjectionGeneration): RejectedResult {
  return rejectedResult("maintenance-blocked", message, generation.identity.generationId);
}
