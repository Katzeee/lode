import type { EngineCommand, RejectedResult } from "@lode/sdk";
import type { AuthorityReceipt, FactSnapshot, FactWrite } from "../../../domain/fact/index.js";
import { sameHardDeleteSelection } from "../../../domain/maintenance/index.js";
import type { ScopedProjectionGeneration } from "../../../domain/reconcile/index.js";
import type { FactAuthority } from "../../authority/fact-authority.js";
import { assessWorkspaceHardDelete } from "../hard-delete.js";
import { rejectedResult } from "../workspace-results.js";
import type { BoundWorkspaceCommand } from "./command-rule.js";

type MaintenancePlan =
  | Readonly<{
      writes: readonly FactWrite[];
      lineage: AuthorityReceipt["lineage"];
    }>
  | RejectedResult;
type MaintenanceCommand = Extract<EngineCommand, { kind: "acknowledge-deletion" | "retire-replica" | "hard-delete" }>;
type MaintenanceAuthority = Pick<FactAuthority, "replicaId" | "uncertainInvocations">;

export function bindMaintenanceCommand(command: MaintenanceCommand): BoundWorkspaceCommand {
  return {
    readPlan: { kind: "mutations", mutations: [], historyChannelId: null },
    plan({ workspaceId, snapshot, generation, maintenanceAuthority }) {
      return planMaintenanceCommand(workspaceId, command, snapshot, generation, maintenanceAuthority);
    },
  };
}

function planMaintenanceCommand(
  workspaceId: string,
  command: MaintenanceCommand,
  snapshot: FactSnapshot,
  generation: ScopedProjectionGeneration,
  authority: MaintenanceAuthority,
): MaintenancePlan {
  if (command.kind === "acknowledge-deletion") {
    const assessment = assessWorkspaceHardDelete(workspaceId, command.nodeId, snapshot, authority);
    if (
      assessment.selection.deletionFactIds.length === 0 ||
      JSON.stringify(command.deletionFactIds) !== JSON.stringify(assessment.selection.deletionFactIds)
    ) {
      return blocked("Deletion acknowledgement does not match the current tombstone", generation);
    }
    return {
      writes: [
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
    return command.replicaId === authority.replicaId || !Object.hasOwn(snapshot.frontier, command.replicaId)
      ? blocked("Only another known Replica can be retired", generation)
      : {
          writes: [
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
  const assessment = assessWorkspaceHardDelete(workspaceId, command.selection.nodeId, snapshot, authority);
  if (!assessment.canExecute || !sameHardDeleteSelection(command.selection, assessment.selection)) {
    return blocked(
      `Hard Delete is blocked or stale: ${assessment.blockers.join(", ") || "selection changed"}`,
      generation,
    );
  }
  return {
    writes: [
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

function blocked(message: string, generation: ScopedProjectionGeneration): RejectedResult {
  return rejectedResult("maintenance-blocked", message, generation.identity.generationId);
}
